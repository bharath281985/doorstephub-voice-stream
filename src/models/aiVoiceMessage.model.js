"use strict";

const mongoose = require("mongoose");

const schema = new mongoose.Schema({}, { strict: false, collection: "ai_voice_messages", timestamps: true });

module.exports = mongoose.models.ai_voice_messages
    || mongoose.model("ai_voice_messages", schema);
