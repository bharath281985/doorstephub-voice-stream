"use strict";

const { GoogleGenAI } = require("@google/genai");
const config = require("../config");
const logger = require("../logger");
const { buildSystemPrompt } = require("../prompts/systemPrompt");

let ai = null;
function getClient() {
    if (!ai) {
        ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    }
    return ai;
}

/**
 * Creates a stateful chat session for one call. Keeps conversation history
 * so Gemini has context across turns.
 */
function createConversation({ language = "en", context = {} } = {}) {
    const systemInstruction = buildSystemPrompt({ language, context });

    const chat = getClient().chats.create({
        model: config.gemini.model,
        config: {
            systemInstruction,
            temperature: 0.6,
            maxOutputTokens: 200,
        },
        history: [],
    });

    return {
        async reply(userText) {
            try {
                const response = await chat.sendMessage({ message: userText });
                const text = (response.text || "").trim();
                return { text, escalate: /\bescalat/i.test(text) };
            } catch (err) {
                logger.error("Gemini reply error:", err.message);
                return {
                    text: "I'm sorry, I'm having trouble right now. Let me connect you to our team.",
                    escalate: true,
                    error: err.message,
                };
            }
        },

        async greeting() {
            try {
                const response = await chat.sendMessage({
                    message: "The call just connected. Greet the customer warmly in one short sentence and ask how you can help.",
                });
                return (response.text || "").trim();
            } catch (err) {
                logger.error("Gemini greeting error:", err.message);
                return "Hello! This is Doorstep Hub. How can I help you today?";
            }
        },
    };
}

module.exports = { createConversation };
