"use strict";

const config = require("../config");
const logger = require("../logger");
const pcm = require("../audio/pcm");
const sttService = require("../services/stt.service");
const ttsService = require("../services/tts.service");
const geminiService = require("../services/gemini.service");
const sessionStore = require("../services/sessionStore.service");

// Frame pacing so we can interrupt (barge-in) mid-utterance.
const FRAME_INTERVAL_MS = Number(config.limits.playbackFrameMs || 55);
// RMS threshold above which we treat incoming audio as speech (barge-in).
const BARGE_IN_RMS = Number(process.env.BARGE_IN_RMS || 2200);
// Consecutive speech frames required to trigger barge-in.
const BARGE_IN_FRAMES = Number(process.env.BARGE_IN_FRAMES || 4);

class CallStream {
    constructor(ws, meta = {}) {
        this.ws = ws;
        this.meta = meta;

        this.streamSid = null;
        this.callSid = null;
        this.session = null;
        this.language = "en";

        this.stt = null;
        this.conversation = null;

        this.botSpeaking = false;
        this.playbackTimer = null;
        this.pendingFrames = [];
        this.speechFrameCount = 0;

        this.processingTurn = false;
        this.pendingUserTurn = null;
        this.lastInterim = "";
        this.transcriptLog = [];
        this.outcome = "";
        this.closed = false;

        this.startedAt = Date.now();
        this.maxCallTimer = setTimeout(
            () => this.endCall("max_duration"),
            config.limits.maxCallSeconds * 1000,
        );
    }

    send(obj) {
        if (this.ws.readyState === this.ws.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    async handleMessage(raw) {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch (_) {
            return;
        }

        switch (msg.event) {
            case "connected":
                logger.info("stream connected");
                break;
            case "start":
                await this.onStart(msg);
                break;
            case "media":
                this.onMedia(msg);
                break;
            case "dtmf":
                this.onDtmf(msg);
                break;
            case "mark":
                // playback position ack — noop for now
                break;
            case "stop":
                await this.onStop(msg);
                break;
            default:
                break;
        }
    }

    async onStart(msg) {
        try {
            const start = msg.start || {};
            this.streamSid = start.stream_sid || msg.stream_sid;
            this.callSid = start.call_sid || "";
            const custom = start.custom_parameters || {};
            const customField =
                custom.session_id ||
                custom.sessionId ||
                custom.CustomField ||
                start.custom_field ||
                start.customField ||
                "";

            logger.info(`stream start call_sid=${this.callSid} stream_sid=${this.streamSid}`);

        // Load the session the main backend created for this call.
        this.session = await sessionStore.findSession({
            customField,
            callSid: this.callSid,
        });

        if (this.session) {
            this.language = this.session.language || "en";
            await sessionStore.updateSession(this.session._id, {
                callStatus: "in_progress",
                callStartedAt: new Date(),
                externalCallId: this.callSid || this.session.externalCallId,
                "metadata.streamSid": this.streamSid,
            });
        } else {
            logger.warn("no matching session found; continuing without DB logging");
        }

        const context = {
            callPurpose: this.session?.callPurpose,
            customerName: this.session?.metadata?.customerName,
            customerLocation:
                this.session?.metadata?.location ||
                this.session?.metadata?.city ||
                this.session?.metadata?.customerLocation ||
                "",
        };

        this.conversation = geminiService.createConversation({
            language: this.language,
            context,
            sessionId: this.session?._id,
        });

        this.startStt();

        // Opening greeting.
        const greeting = await this.conversation.greeting();
        await this.speak(greeting, "ai");
        } catch (err) {
            logger.error("onStart failed:", err.message);
        }
    }

    startStt() {
        this.stt = sttService.createStream({
            language: this.language,
            onInterim: (text) => {
                this.lastInterim = text;
            },
            onFinal: (text, confidence) => {
                if (text) this.onUserUtterance(text, confidence);
            },
            onError: (err) => {
                logger.error("stt error, restarting:", err.message);
                if (!this.closed) {
                    try {
                        this.stt.restart(err?.message || "stream_error");
                    } catch (_) {
                        /* noop */
                    }
                }
            },
        });
    }

    onMedia(msg) {
        const payload = msg.media?.payload;
        if (!payload) return;
        const buf = pcm.base64ToBuffer(payload);

        // Feed the recognizer.
        if (this.stt) this.stt.write(buf);

        // Barge-in detection while the bot is talking.
        if (this.botSpeaking) {
            const energy = pcm.rmsEnergy(buf);
            if (energy > BARGE_IN_RMS) {
                this.speechFrameCount += 1;
                if (this.speechFrameCount >= BARGE_IN_FRAMES) {
                    this.stopPlayback(true);
                }
            } else {
                this.speechFrameCount = 0;
            }
        }
    }

    onDtmf(msg) {
        const digit = msg.dtmf?.digit;
        logger.info(`dtmf: ${digit}`);
        if (digit === "0") {
            // Convention: 0 => request human.
            this.outcome = "escalated";
            this.speak("Connecting you to our support team now. Please hold.", "ai").then(() =>
                this.endCall("dtmf_escalation"),
            );
        }
    }

    async onUserUtterance(text, confidence) {
        if (!text || !String(text).trim()) return;
        this.pendingUserTurn = { text: String(text).trim(), confidence };
        if (this.processingTurn) return;

        while (this.pendingUserTurn && !this.closed) {
            const turn = this.pendingUserTurn;
            this.pendingUserTurn = null;
            this.processingTurn = true;

            logger.info(`customer: ${turn.text}`);
            this.transcriptLog.push({ speaker: "customer", text: turn.text });
            sessionStore.addMessage({
                sessionId: this.session?._id,
                speaker: "customer",
                language: this.language,
                transcriptText: turn.text,
                confidence: turn.confidence,
            });

            const { text: reply, escalate, error } = await this.conversation.reply(turn.text);
            if (escalate) this.outcome = "escalated";

            if (reply) {
                await this.speak(reply, "ai");
            }

            this.processingTurn = false;

            if (escalate && !error) {
                // Give the closing line time to play, then end.
                setTimeout(() => this.endCall("escalated"), 1200);
                return;
            }
        }
    }

    /** Synthesize `text` and stream it to the caller, pace-able for barge-in. */
    async speak(text, speaker = "ai") {
        if (!text || this.closed) return;
        logger.info(`bot: ${text}`);
        this.transcriptLog.push({ speaker, text });
        sessionStore.addMessage({
            sessionId: this.session?._id,
            speaker,
            language: this.language,
            transcriptText: text,
        });

        let audio;
        try {
            audio = await ttsService.synthesize(text, this.language);
        } catch (err) {
            logger.error("tts error:", err.message);
            return;
        }
        if (!audio || !audio.length) return;

        const frames = pcm.splitIntoFrames(audio);
        await this.playFrames(frames);
    }

    playFrames(frames) {
        return new Promise((resolve) => {
            this.playbackResolve = resolve;
            this.pendingFrames = frames.slice();
            this.botSpeaking = true;
            this.speechFrameCount = 0;

            const tick = () => {
                if (this.closed || this.pendingFrames.length === 0) {
                    this.finishPlayback();
                    return resolve();
                }
                const frame = this.pendingFrames.shift();
                this.send({
                    event: "media",
                    stream_sid: this.streamSid,
                    media: { payload: pcm.bufferToBase64(frame) },
                });
                this.playbackTimer = setTimeout(tick, FRAME_INTERVAL_MS);
            };
            tick();
        }).finally(() => {
            this.playbackResolve = null;
        });
    }

    stopPlayback(bargeIn = false) {
        if (!this.botSpeaking) return;
        this.pendingFrames = [];
        if (this.playbackTimer) {
            clearTimeout(this.playbackTimer);
            this.playbackTimer = null;
        }
        if (bargeIn) {
            // Flush Exotel's buffered audio so the caller can talk over the bot.
            this.send({ event: "clear", stream_sid: this.streamSid });
            logger.info("barge-in: playback cleared");
        }
        this.finishPlayback();
        if (this.playbackResolve) {
            this.playbackResolve();
        }
    }

    finishPlayback() {
        this.botSpeaking = false;
        this.speechFrameCount = 0;
        if (this.playbackTimer) {
            clearTimeout(this.playbackTimer);
            this.playbackTimer = null;
        }
    }

    async onStop(msg) {
        const reason = msg.stop?.reason || "stopped";
        logger.info(`stream stop reason=${reason}`);
        await this.endCall(reason);
    }

    async endCall(reason) {
        if (this.closed) return;
        this.closed = true;

        this.finishPlayback();
        clearTimeout(this.maxCallTimer);
        if (this.stt) this.stt.end();

        const durationSec = Math.floor((Date.now() - this.startedAt) / 1000);
        const transcript = this.transcriptLog
            .map((t) => `${t.speaker === "customer" ? "Customer" : "AI"}: ${t.text}`)
            .join("\n");

        await sessionStore.updateSession(this.session?._id, {
            callStatus: reason === "callended" || reason === "stopped" ? "completed" : "completed",
            callEndedAt: new Date(),
            duration: durationSec,
            transcript,
            outcome: this.outcome || "no_action",
            "metadata.endReason": reason,
        });

        try {
            if (this.ws.readyState === this.ws.OPEN) this.ws.close(1000, "call ended");
        } catch (_) {
            /* noop */
        }
        logger.info(`call ended reason=${reason} duration=${durationSec}s`);
    }
}

module.exports = { CallStream };
