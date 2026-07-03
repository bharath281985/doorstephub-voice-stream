"use strict";

const config = require("../config");
const logger = require("../logger");

// Schema type literals (match the @google/genai Type enum values).
const OBJECT = "OBJECT";
const STRING = "STRING";

/**
 * Gemini function declarations. These map 1:1 to the actions the cPanel
 * backend can perform (see ai-voice/services/action.service.js).
 */
const functionDeclarations = [
    {
        name: "send_payment_link",
        description:
            "Generate and send a secure payment link to the customer on WhatsApp for their pending booking. Use when the customer agrees to pay or asks for a payment link.",
        parameters: { type: OBJECT, properties: {} },
    },
    {
        name: "send_whatsapp_message",
        description:
            "Send a short text message to the customer on WhatsApp (e.g. booking details, an address, or a summary). Use when you promise to send something in writing.",
        parameters: {
            type: OBJECT,
            properties: {
                message: {
                    type: STRING,
                    description: "The exact message text to send to the customer.",
                },
            },
            required: ["message"],
        },
    },
    {
        name: "schedule_callback",
        description:
            "Record that the customer wants a callback at a later time. Use when the customer is busy or asks to be called back.",
        parameters: {
            type: OBJECT,
            properties: {
                preferredTime: {
                    type: STRING,
                    description: "When the customer wants to be called back, in their own words.",
                },
                note: {
                    type: STRING,
                    description: "Optional short note about what the callback is for.",
                },
            },
        },
    },
    {
        name: "escalate_to_human",
        description:
            "Flag the call for a human support agent. Use when the customer is frustrated, explicitly asks for a person, or needs something you cannot do.",
        parameters: {
            type: OBJECT,
            properties: {
                reason: {
                    type: STRING,
                    description: "Short reason for the escalation.",
                },
            },
        },
    },
    {
        name: "capture_outcome",
        description:
            "Record the structured outcome of the call. Call this once near the end of the conversation to summarise what happened.",
        parameters: {
            type: OBJECT,
            properties: {
                outcome: {
                    type: STRING,
                    description:
                        "One of: payment_sent, booking_confirmed, rescheduled, cancelled, escalated, no_action, callback_requested.",
                },
                intent: {
                    type: STRING,
                    description: "The customer's main intent in a few words.",
                },
                note: {
                    type: STRING,
                    description: "A one or two sentence summary of the call.",
                },
            },
        },
    },
];

/**
 * Execute an action by calling the cPanel backend. Never throws — always
 * returns a result object so it can be fed back to Gemini as a tool response.
 */
async function execute(sessionId, name, args = {}) {
    if (!config.backend.internalToken) {
        logger.warn("actions disabled: AI_VOICE_INTERNAL_TOKEN not set");
        return { success: false, message: "Actions are not configured on this server." };
    }
    if (!sessionId) {
        return { success: false, message: "No call session is linked; cannot take this action." };
    }

    try {
        const res = await fetch(config.backend.actionsUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-internal-token": config.backend.internalToken,
            },
            body: JSON.stringify({ sessionId: String(sessionId), action: name, args }),
            signal: AbortSignal.timeout(30000),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            logger.error(`action ${name} http ${res.status}`);
            return {
                success: false,
                message: json?.data?.message || json?.message || "The action could not be completed.",
            };
        }
        return json.data || { success: true, message: "Done." };
    } catch (err) {
        logger.error(`action ${name} failed:`, err.message);
        return {
            success: false,
            message: "The action could not be completed right now.",
        };
    }
}

module.exports = { functionDeclarations, execute };
