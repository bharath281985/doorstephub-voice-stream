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
        sttModel: process.env.STT_MODEL || "latest_short",
        ttsLanguage: process.env.TTS_LANGUAGE || "en-IN",
        ttsVoice: process.env.TTS_VOICE || "en-IN-Neural2-A",
        // When true, STT also listens for these extra languages on the same
        // call, so a caller can code-switch (e.g. Hindi call + English words).
        sttAutoDetect: bool(process.env.STT_AUTO_DETECT, true),
        // Up to 3 BCP-47 codes used as alternatives to the session language.
        sttAlternativeLanguages: (process.env.STT_ALTERNATIVE_LANGUAGES || "en-IN,hi-IN")
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
        // Chirp3-HD speaker used across all languages (warm female = "Diya").
        ttsChirpVoice: process.env.TTS_CHIRP_VOICE || "Kore",
    },

    gemini: {
        apiKey: process.env.AI_API_KEY || "",
        model: process.env.AI_MODEL || "gemini-2.0-flash",
    },

    // Main cPanel backend — the AI calls these endpoints to take real actions
    // (payment link, WhatsApp, callback, escalation) during a live call.
    backend: {
        actionsUrl:
            process.env.BACKEND_ACTIONS_URL ||
            "https://api.doorstephub.com/v1/dhubApi/web/ai-voice/actions",
        internalToken: process.env.AI_VOICE_INTERNAL_TOKEN || "",
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
        playbackFrameMs: Number(process.env.PLAYBACK_FRAME_MS || 55),
    },
};

module.exports = config;
