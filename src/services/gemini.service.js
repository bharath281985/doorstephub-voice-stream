"use strict";

const { GoogleGenAI } = require("@google/genai");
const config = require("../config");
const logger = require("../logger");
const { buildSystemPrompt } = require("../prompts/systemPrompt");
const actionsService = require("./actions.service");

let ai = null;
function getClient() {
    if (!ai) {
        ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    }
    return ai;
}

// Cap tool-call round-trips per user turn so a misbehaving model can't loop.
const MAX_TOOL_ROUNDS = 4;

/**
 * Creates a stateful chat session for one call. Keeps conversation history
 * so Gemini has context across turns.
 *
 * @param {object} opts
 * @param {string} [opts.sessionId] AI voice session id used for taking actions.
 */
function createConversation({ language = "en", context = {}, sessionId = null } = {}) {
    const systemInstruction = buildSystemPrompt({ language, context });

    const chat = getClient().chats.create({
        model: config.gemini.model,
        config: {
            systemInstruction,
            temperature: 0.6,
            maxOutputTokens: 200,
            tools: [{ functionDeclarations: actionsService.functionDeclarations }],
        },
        history: [],
    });

    // Runs the model, executing any tool calls and feeding results back until
    // the model returns a plain-text reply (or we hit the round cap).
    async function runTurn(message) {
        let response = await chat.sendMessage({ message });
        let escalate = false;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
            const calls = response.functionCalls || [];
            if (!calls.length) break;

            const responses = [];
            for (const call of calls) {
                if (call.name === "escalate_to_human") escalate = true;
                logger.info(`tool call: ${call.name} ${JSON.stringify(call.args || {})}`);
                const result = await actionsService.execute(sessionId, call.name, call.args || {});
                responses.push({
                    functionResponse: { name: call.name, response: result },
                });
            }

            response = await chat.sendMessage({ message: responses });
        }

        return { text: (response.text || "").trim(), escalate };
    }

    return {
        async reply(userText) {
            try {
                const { text, escalate } = await runTurn(userText);
                return { text, escalate: escalate || /\bescalat/i.test(text) };
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
