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

const LANGUAGE_CODES = {
    en: "en-IN",
    hi: "hi-IN",
    te: "te-IN",
    kn: "kn-IN",
    ta: "ta-IN",
};

// Older, always-available voices used as a safety net if the premium
// Chirp3-HD voice is unavailable in the region / project.
const FALLBACK_VOICES = {
    en: "en-IN-Neural2-A",
    hi: "hi-IN-Neural2-A",
    te: "te-IN-Standard-A",
    kn: "kn-IN-Standard-A",
    ta: "ta-IN-Standard-A",
};

/**
 * Resolve the voice for a language. Prefers a premium Chirp3-HD voice, allows
 * per-language override via env (e.g. TTS_VOICE_TE), and keeps a fallback.
 */
function resolveVoice(language) {
    const lang = LANGUAGE_CODES[language] ? language : "en";
    const languageCode = LANGUAGE_CODES[lang];
    const override = process.env[`TTS_VOICE_${lang.toUpperCase()}`];
    const primary = override || `${languageCode}-Chirp3-HD-${config.google.ttsChirpVoice}`;
    return { languageCode, primary, fallback: FALLBACK_VOICES[lang] };
}

async function requestSpeech(text, languageCode, name) {
    const [response] = await getClient().synthesizeSpeech({
        input: { text },
        voice: { languageCode, name },
        audioConfig: {
            audioEncoding: "LINEAR16",
            sampleRateHertz: config.audio.sampleRate,
        },
    });
    if (!response.audioContent) return Buffer.alloc(0);
    const buffer = Buffer.isBuffer(response.audioContent)
        ? response.audioContent
        : Buffer.from(response.audioContent, "base64");
    return stripWavHeader(buffer);
}

/**
 * Synthesize text to raw LINEAR16 PCM (headerless) at the call sample rate.
 * Tries the premium voice, falls back to a Standard/Neural2 voice on failure.
 * @returns {Promise<Buffer>} raw PCM buffer
 */
async function synthesize(text, language = "en") {
    if (!text || !text.trim()) return Buffer.alloc(0);

    const voice = resolveVoice(language);
    try {
        return await requestSpeech(text, voice.languageCode, voice.primary);
    } catch (err) {
        logger.warn(
            `TTS voice ${voice.primary} failed (${err.message}); falling back to ${voice.fallback}`,
        );
        try {
            return await requestSpeech(text, voice.languageCode, voice.fallback);
        } catch (err2) {
            logger.error("TTS fallback failed:", err2.message);
            return Buffer.alloc(0);
        }
    }
}

module.exports = { synthesize, resolveVoice, LANGUAGE_CODES, FALLBACK_VOICES };
