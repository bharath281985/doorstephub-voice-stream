"use strict";

require("dotenv").config();

function bool(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    return String(value).toLowerCase() === "true";
}

const config = {
    port: Number(process.env.PORT || 5014),
    wsPath: process.env.WS_PATH || "/stream",
    enabled: bool(process.env.AI_VOICE_STREAM_ENABLED, true),

    mongoUri: process.env.MONGO_URI || "",

    audio: {
        sampleRate: Number(process.env.AUDIO_SAMPLE_RATE || 16000),
    },

    google: {
        credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || "",
        projectId: process.env.GCP_PROJECT_ID || "",
        sttLanguage: process.env.STT_LANGUAGE || "en-IN",
        ttsLanguage: process.env.TTS_LANGUAGE || "en-IN",
        ttsVoice: process.env.TTS_VOICE || "en-IN-Neural2-A",
    },

    gemini: {
        apiKey: process.env.AI_API_KEY || "",
        model: process.env.AI_MODEL || "gemini-2.0-flash",
    },

    security: {
        allowedIps: (process.env.ALLOWED_IPS || "")
            .split(",")
            .map((ip) => ip.trim())
            .filter(Boolean),
        basicAuthUser: process.env.WS_BASIC_AUTH_USER || "",
        basicAuthPass: process.env.WS_BASIC_AUTH_PASS || "",
    },

    limits: {
        maxCallSeconds: Number(process.env.MAX_CALL_SECONDS || 600),
        silenceTimeoutMs: Number(process.env.SILENCE_TIMEOUT_MS || 8000),
    },
};

module.exports = config;
