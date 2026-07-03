"use strict";

// Lenient schema that writes to the SAME "ai_voice_sessions" collection used by
// the main cPanel backend. strict:false so we can update stream-specific fields
// without duplicating the full enum definitions.
const mongoose = require("mongoose");

const schema = new mongoose.Schema({}, { strict: false, collection: "ai_voice_sessions", timestamps: true });

module.exports = mongoose.models.ai_voice_sessions
    || mongoose.model("ai_voice_sessions", schema);
