"use strict";

const speech = require("@google-cloud/speech");
const config = require("../config");
const logger = require("../logger");

// One shared client. Uses GOOGLE_APPLICATION_CREDENTIALS service account.
let client = null;
function getClient() {
    if (!client) client = new speech.SpeechClient();
    return client;
}

const LANG_MAP = {
    en: "en-IN",
    hi: "hi-IN",
    te: "te-IN",
    kn: "kn-IN",
    ta: "ta-IN",
};

const STREAM_ROLLOVER_MS = 4.5 * 60 * 1000;

/**
 * Creates a streaming recognizer for one call turn / session.
 * Emits interim + final transcripts via the provided callbacks.
 *
 * @returns {{ write: (buf:Buffer)=>void, end: ()=>void, restart: ()=>void }}
 */
function createStream({ language = "en", onInterim, onFinal, onError }) {
    const languageCode = LANG_MAP[language] || config.google.sttLanguage;

    const request = {
        config: {
            encoding: "LINEAR16",
            sampleRateHertz: config.audio.sampleRate,
            languageCode,
            enableAutomaticPunctuation: true,
            model: "latest_long",
            useEnhanced: true,
        },
        interimResults: true,
    };

    // Let the caller speak in more than just the session language. Google
    // accepts up to 3 alternative language codes for on-the-fly detection.
    if (config.google.sttAutoDetect) {
        const alternatives = config.google.sttAlternativeLanguages
            .filter((code) => code && code !== languageCode)
            .slice(0, 3);
        if (alternatives.length) {
            request.config.alternativeLanguageCodes = alternatives;
        }
    }

    let recognizeStream = null;
    let closed = false;
    let restarting = false;
    let streamGeneration = 0;
    let rolloverTimer = null;

    function clearRolloverTimer() {
        if (rolloverTimer) {
            clearTimeout(rolloverTimer);
            rolloverTimer = null;
        }
    }

    function scheduleRollover() {
        clearRolloverTimer();
        rolloverTimer = setTimeout(() => {
            api.restart("rollover");
        }, STREAM_ROLLOVER_MS);
    }

    function cleanupStream(stream) {
        if (!stream) return;
        try {
            stream.removeAllListeners("error");
            stream.removeAllListeners("data");
        } catch (_) {
            /* noop */
        }
        try {
            if (!stream.destroyed && !stream.writableEnded) {
                stream.end();
            }
        } catch (_) {
            /* noop */
        }
        try {
            if (!stream.destroyed) {
                stream.destroy();
            }
        } catch (_) {
            /* noop */
        }
    }

    function start() {
        const currentGeneration = ++streamGeneration;
        recognizeStream = getClient()
            .streamingRecognize(request)
            .on("error", (err) => {
                if (closed || currentGeneration !== streamGeneration) return;
                logger.error("STT stream error:", err.message);
                if (onError) onError(err);
            })
            .on("data", (data) => {
                if (closed || currentGeneration !== streamGeneration) return;
                const result = data.results?.[0];
                if (!result || !result.alternatives?.[0]) return;
                const transcript = result.alternatives[0].transcript || "";
                if (result.isFinal) {
                    if (onFinal) onFinal(transcript.trim(), result.alternatives[0].confidence);
                } else if (onInterim) {
                    onInterim(transcript.trim());
                }
            });
        scheduleRollover();
    }

    start();

    const api = {
        write(buf) {
            if (
                !closed &&
                !restarting &&
                recognizeStream &&
                !recognizeStream.destroyed &&
                !recognizeStream.writableEnded &&
                typeof recognizeStream.write === "function"
            ) {
                try {
                    recognizeStream.write(buf);
                } catch (err) {
                    logger.error("STT write error:", err.message);
                }
            }
        },
        end() {
            closed = true;
            clearRolloverTimer();
            cleanupStream(recognizeStream);
            recognizeStream = null;
        },
        // Google streaming STT has a ~5min limit; call restart() to renew.
        restart(reason = "manual") {
            if (closed || restarting) return;
            restarting = true;
            logger.info(`STT stream restart: ${reason}`);
            clearRolloverTimer();
            const previousStream = recognizeStream;
            recognizeStream = null;
            cleanupStream(previousStream);
            start();
            restarting = false;
        },
    };
    return api;
}

module.exports = { createStream, LANG_MAP };
