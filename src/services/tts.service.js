"use strict";

const textToSpeech = require("@google-cloud/text-to-speech");
const config = require("../config");
const logger = require("../logger");
const { stripWavHeader } = require("../audio/pcm");

let client = null;
function getClient() {
    if (!client) client = new textToSpeech.TextToSpeechClient();
    return client;
}

const VOICE_MAP = {
    en: { languageCode: "en-IN", name: "en-IN-Neural2-A" },
    hi: { languageCode: "hi-IN", name: "hi-IN-Neural2-A" },
    te: { languageCode: "te-IN", name: "te-IN-Standard-A" },
    kn: { languageCode: "kn-IN", name: "kn-IN-Standard-A" },
    ta: { languageCode: "ta-IN", name: "ta-IN-Standard-A" },
};

/**
 * Synthesize text to raw LINEAR16 PCM (headerless) at the call sample rate.
 * @returns {Promise<Buffer>} raw PCM buffer
 */
async function synthesize(text, language = "en") {
    if (!text || !text.trim()) return Buffer.alloc(0);

    const voice = VOICE_MAP[language] || VOICE_MAP.en;

    const [response] = await getClient().synthesizeSpeech({
        input: { text },
        voice: { languageCode: voice.languageCode, name: voice.name },
        audioConfig: {
            audioEncoding: "LINEAR16",
            sampleRateHertz: config.audio.sampleRate,
        },
    });

    if (!response.audioContent) {
        logger.warn("TTS returned empty audio");
        return Buffer.alloc(0);
    }

    const buffer = Buffer.isBuffer(response.audioContent)
        ? response.audioContent
        : Buffer.from(response.audioContent, "base64");

    return stripWavHeader(buffer);
}

module.exports = { synthesize, VOICE_MAP };
