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

function buildGreetingInstruction(context = {}) {
    const purpose = String(context.callPurpose || "general").trim();

    if (purpose === "marketing") {
        return "The call just connected. In one short, natural opening, introduce yourself as Diya from Doorstep Hub, say you are calling about doorstep repair and home services, and ask what service the customer needs in their city right now.";
    }

    if (purpose === "booking_recovery") {
        return "The call just connected. In one short sentence, introduce yourself as Diya from Doorstep Hub, mention that the customer's booking was left incomplete, and ask if you can help them continue it.";
    }

    if (purpose === "payment_followup") {
        return "The call just connected. In one short sentence, introduce yourself as Diya from Doorstep Hub, mention the customer's pending booking payment, and ask if they need help completing it.";
    }

    if (purpose === "support") {
        return "The call just connected. In one short sentence, introduce yourself as Diya from Doorstep Hub support and ask how you can help with their issue today.";
    }

    if (purpose === "provider_update") {
        return "The call just connected. In one short sentence, introduce yourself as Diya from Doorstep Hub and say you are calling with an update on their booking, then briefly ask if this is a good time.";
    }

    return "The call just connected. Greet the customer warmly in one short sentence and ask how you can help.";
}

function buildGreetingFallback(context = {}) {
    const purpose = String(context.callPurpose || "general").trim();

    if (purpose === "marketing") {
        return "Hello! This is Diya from Doorstep Hub. We help with doorstep repair and home services. What service are you looking for today?";
    }

    if (purpose === "booking_recovery") {
        return "Hello! This is Diya from Doorstep Hub. I noticed your booking was not completed. Shall I help you continue it?";
    }

    if (purpose === "payment_followup") {
        return "Hello! This is Diya from Doorstep Hub. Your booking payment is still pending. Would you like help completing it today?";
    }

    if (purpose === "support") {
        return "Hello! This is Diya from Doorstep Hub support. How can I help you today?";
    }

    if (purpose === "provider_update") {
        return "Hello! This is Diya from Doorstep Hub. I am calling with an update on your booking.";
    }

    return "Hello! This is Doorstep Hub. How can I help you today?";
}

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
            maxOutputTokens: 120,
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
                    message: buildGreetingInstruction(context),
                });
                return (response.text || "").trim();
            } catch (err) {
                logger.error("Gemini greeting error:", err.message);
                return buildGreetingFallback(context);
            }
        },
    };
}

module.exports = { createConversation };
