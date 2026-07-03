"use strict";

const mongoose = require("mongoose");
const AiVoiceSession = require("../models/aiVoiceSession.model");
const AiVoiceMessage = require("../models/aiVoiceMessage.model");
const db = require("../db");
const logger = require("../logger");

function toObjectId(value) {
    if (!value) return null;
    try {
        return new mongoose.Types.ObjectId(String(value));
    } catch (_) {
        return null;
    }
}

/**
 * Find the session that the main backend created when it triggered the call.
 * We match by the CustomField (session _id) passed through the stream start
 * event, falling back to the Exotel call_sid.
 */
async function findSession({ customField, callSid }) {
    if (!db.isConnected()) return null;

    const sessionId = toObjectId(customField);
    if (sessionId) {
        const byId = await AiVoiceSession.findById(sessionId);
        if (byId) return byId;
    }
    if (callSid) {
        const byCall = await AiVoiceSession.findOne({ externalCallId: callSid });
        if (byCall) return byCall;
    }
    return null;
}

async function updateSession(sessionId, patch) {
    if (!db.isConnected() || !sessionId) return null;
    try {
        return await AiVoiceSession.findByIdAndUpdate(sessionId, { $set: patch }, { new: true });
    } catch (err) {
        logger.error("updateSession error:", err.message);
        return null;
    }
}

async function addMessage({ sessionId, speaker, language, transcriptText, confidence }) {
    if (!db.isConnected() || !sessionId) return null;
    try {
        return await AiVoiceMessage.create({
            sessionId: toObjectId(sessionId),
            speaker,
            language: language || "en",
            transcriptText: transcriptText || "",
            confidence: confidence ?? null,
        });
    } catch (err) {
        logger.error("addMessage error:", err.message);
        return null;
    }
}

module.exports = { findSession, updateSession, addMessage, toObjectId };
