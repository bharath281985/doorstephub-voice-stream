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

    function start() {
        recognizeStream = getClient()
            .streamingRecognize(request)
            .on("error", (err) => {
                logger.error("STT stream error:", err.message);
                if (onError) onError(err);
            })
            .on("data", (data) => {
                const result = data.results?.[0];
                if (!result || !result.alternatives?.[0]) return;
                const transcript = result.alternatives[0].transcript || "";
                if (result.isFinal) {
                    if (onFinal) onFinal(transcript.trim(), result.alternatives[0].confidence);
                } else if (onInterim) {
                    onInterim(transcript.trim());
                }
            });
    }

    start();

    return {
        write(buf) {
            if (recognizeStream && !recognizeStream.destroyed) {
                try {
                    recognizeStream.write(buf);
                } catch (err) {
                    logger.error("STT write error:", err.message);
                }
            }
        },
        end() {
            if (recognizeStream && !recognizeStream.destroyed) {
                try {
                    recognizeStream.end();
                } catch (_) {
                    /* noop */
                }
            }
        },
        // Google streaming STT has a ~5min limit; call restart() to renew.
        restart() {
            this.end();
            start();
        },
    };
}

module.exports = { createStream, LANG_MAP };
