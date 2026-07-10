"use strict";

const { GoogleGenAI } = require("@google/genai");
const config = require("../config");
const logger = require("../logger");
const { buildSystemPrompt } = require("../prompts/systemPrompt");
const actionsService = require("./actions.service");
const {
    getProfessionalVerticalCopy,
    formatHomeApplianceCatalogPitch,
} = require("../utils/professionalOnboarding");

let ai = null;
function getClient() {
    if (!ai) {
        ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    }
    return ai;
}

// Cap tool-call round-trips per user turn so a misbehaving model can't loop.
const MAX_TOOL_ROUNDS = 4;
const PREFLIGHT_LOOKUP_PURPOSES = new Set(["marketing", "general", "manual_test"]);
const PARTNER_LEAD_CONTEXTS = new Set([
    "vendorEnquiry",
    "provider",
    "professionalProvider",
    "pendingServiceProvider",
    "pendingProfessionalProvider",
]);

function isPendingProfessionalProviderContext(context = {}) {
    return String(context.sourceContext || "").trim() === "pendingProfessionalProvider";
}

function isPendingServiceProviderContext(context = {}) {
    return String(context.sourceContext || "").trim() === "pendingServiceProvider";
}

function buildLiveCatalogSpeechLine(context = {}) {
    if (isPendingServiceProviderContext(context)) {
        return formatHomeApplianceCatalogPitch({
            categories: extractCatalogPart(context.liveCatalogSummary, "Categories"),
            subcategories: extractCatalogPart(context.liveCatalogSummary, "Subcategories"),
            services: extractCatalogPart(context.liveCatalogSummary, "Services"),
        }).replace(/^Doorstep Hub partner onboarding is focused on home appliance services only, including /, "").replace(/\.$/, "") || "home appliance repair and related appliance services";
    }

    const summary = String(context.liveCatalogSummary || "").trim();
    if (!summary) {
        return "our live Doorstep Hub service catalog";
    }

    const categoriesMatch = summary.match(/Categories:\s*([^|]+)/i);
    if (categoriesMatch?.[1]?.trim()) {
        return `services such as ${categoriesMatch[1].trim()}`;
    }

    return `our live services: ${summary.replace(/\s*\|\s*/g, ", ")}`;
}

function extractCatalogPart(summary = "", label = "") {
    const match = String(summary || "").match(new RegExp(`${label}:\\s*([^|]+)`, "i"));
    if (!match?.[1]) return [];
    return match[1]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function getProfessionalContextMeta(context = {}) {
    return {
        sourceServiceName: context.sourceServiceName || "",
        sourceCategory: context.sourceCategory || "",
        sourceRequirement: context.sourceRequirement || "",
        sourceRemarks: context.sourceRemarks || "",
    };
}

function isPartnerLeadContext(context = {}) {
    return PARTNER_LEAD_CONTEXTS.has(String(context.sourceContext || "").trim());
}

function buildGreetingInstruction(context = {}) {
    const purpose = String(context.callPurpose || "general").trim();
    const sourceContext = String(context.sourceContext || "").trim();
    const sourceRequirement = String(context.sourceRequirement || "").trim();
    const sourceCategory = String(context.sourceCategory || "").trim();
    const isPartnerLead = PARTNER_LEAD_CONTEXTS.has(sourceContext);

    if (sourceContext === "pendingServiceProvider") {
        return "The call just connected. In one short natural opening, introduce yourself as Diya from Doorstep Hub, warmly ask whether they are a vendor or home appliance service technician who wants to grow their business, briefly mention that Doorstep Hub partner onboarding is for home appliance services only and use the live home-appliance catalog summary in context, invite them to join the Doorstep Hub partner network, and mention that you are sending the partner onboarding details on WhatsApp.";
    }

    if (sourceContext === "pendingProfessionalProvider") {
        const verticalCopy = getProfessionalVerticalCopy(getProfessionalContextMeta(context));
        return `The call just connected. In one short natural opening, introduce yourself as Diya from Doorstep Hub, explain that Doorstep Hub helps professional partners get bookings for ${verticalCopy.examples}, ask ${verticalCopy.askLine.replace("?", "")} in a natural way, and mention that if yes they can download the Partner app and start getting bookings now while you send onboarding details on WhatsApp.`;
    }

    if (isPartnerLead) {
        return `The call just connected. In one short natural opening, introduce yourself as Diya from Doorstep Hub, say you saw they are an appliance service technician or partner interested in joining Doorstep Hub${sourceCategory ? ` for ${sourceCategory}` : ""}${sourceRequirement ? ` regarding ${sourceRequirement}` : ""}, say you are sending the partner onboarding details on WhatsApp, and do not ask if they need any service.`;
    }

    if (sourceContext === "enquiry") {
        return `The call just connected. In one short natural opening, introduce yourself as Diya from Doorstep Hub, mention that they were looking for a service${sourceRequirement ? ` like ${sourceRequirement}` : ""}, ask whether they are currently looking for appliance service or another home service, and keep the tone warm and sales-friendly.`;
    }

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
    const sourceContext = String(context.sourceContext || "").trim();
    const sourceRequirement = String(context.sourceRequirement || "").trim();
    const sourceCategory = String(context.sourceCategory || "").trim();
    const isPartnerLead = PARTNER_LEAD_CONTEXTS.has(sourceContext);

    if (sourceContext === "pendingServiceProvider") {
        const partnerScope = [sourceCategory, sourceRequirement].filter(Boolean).join(" - ");
        const servicesLine = buildLiveCatalogSpeechLine(context);
        return `Hello! This is Diya from Doorstep Hub. Are you a vendor or home appliance service technician looking to grow your business? We help partners receive more customer bookings for home appliance services such as ${servicesLine}${partnerScope ? ` in ${partnerScope}` : ""}. Join Doorstep Hub to increase your business and get customer leads in your area. We are sending the partner onboarding details on WhatsApp now.`;
    }

    if (sourceContext === "pendingProfessionalProvider") {
        const verticalCopy = getProfessionalVerticalCopy(getProfessionalContextMeta(context));
        const partnerScope = [sourceCategory, sourceRequirement].filter(Boolean).join(" - ");
        return `Hello! This is Diya from Doorstep Hub. ${verticalCopy.pitchLine}${partnerScope ? ` We see your profile is related to ${partnerScope}.` : ""} ${verticalCopy.askLine} ${verticalCopy.closeLine}`;
    }

    if (isPartnerLead) {
        const partnerScope = [sourceCategory, sourceRequirement].filter(Boolean).join(" - ");
        return `Hello! This is Diya from Doorstep Hub. We saw your interest in joining as a service technician${partnerScope ? ` for ${partnerScope}` : ""}. We are sending the partner onboarding details on WhatsApp now.`;
    }

    if (sourceContext === "enquiry") {
        return `Hello! This is Diya from Doorstep Hub. I understand you were looking for a service${sourceRequirement ? ` like ${sourceRequirement}` : ""}. Are you currently looking for appliance service or another doorstep home service?`;
    }

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

function shouldRunPrefightLookup(userText = "", context = {}, sessionId = null) {
    if (!sessionId) return false;
    const purpose = String(context.callPurpose || "").trim();
    if (!PREFLIGHT_LOOKUP_PURPOSES.has(purpose)) return false;
    const text = String(userText || "").trim();
    if (text.length < 4) return false;
    if (/^(yes|no|okay|ok|hmm|hello|hi)$/i.test(text)) return false;
    return true;
}

function summarizeLookupResult(result = {}) {
    const lines = [];
    lines.push("Live backend availability check:");
    lines.push(`- Query: ${String(result.query || "").trim() || "unknown"}`);
    lines.push(`- City: ${String(result.city || "").trim() || "unknown"}`);
    lines.push(`- Available: ${result.available ? "likely yes" : "no clear match yet"}`);

    const matches = Array.isArray(result.matches) ? result.matches.slice(0, 6) : [];
    if (matches.length) {
        lines.push("- Matching live catalog entries:");
        for (const item of matches) {
            const label = String(item.label || "").trim();
            const category = String(item.categoryName || "").trim();
            const subcategory = String(item.subcategoryName || "").trim();
            const parts = [label];
            if (category && category.toLowerCase() !== label.toLowerCase()) parts.push(`category: ${category}`);
            if (subcategory && subcategory.toLowerCase() !== label.toLowerCase()) {
                parts.push(`subcategory: ${subcategory}`);
            }
            lines.push(`  - ${parts.join(" | ")}`);
        }
    }

    if (!result.available) {
        lines.push(
            "- Instruction: do not give a hard no. Say the team will verify and follow up unless the customer asks for immediate escalation.",
        );
    }

    return lines.join("\n");
}

async function buildPrefightLookupContext(userText = "", context = {}, sessionId = null) {
    if (!shouldRunPrefightLookup(userText, context, sessionId)) {
        return userText;
    }

    try {
        const lookup = await actionsService.execute(sessionId, "lookup_service_availability", {
            query: userText,
            city: context.customerLocation || "",
        });

        if (!lookup?.success) {
            return userText;
        }

        logger.info(
            `prefight lookup available=${lookup.available ? "yes" : "no"} query=${JSON.stringify(lookup.query || userText)}`,
        );

        return [
            `Customer exact words: ${String(userText || "").trim()}`,
            summarizeLookupResult(lookup),
            "Use the live backend data above while answering. Prefer matching categories, subcategories, and services from the server over generic assumptions.",
        ].join("\n\n");
    } catch (err) {
        logger.warn("prefight lookup failed:", err.message);
        return userText;
    }
}

function buildPartnerLeadTurnContext(userText = "", context = {}) {
    const city = String(context.customerLocation || "").trim();
    const category = String(context.sourceCategory || context.sourceRequirement || "").trim();

    return [
        "Partner onboarding reminder:",
        "- This caller is a technician or service partner lead, not a customer lead.",
        "- Do not ask what service they need, do not ask if they want appliance repair, and do not switch into customer booking support.",
        "- Keep the conversation focused on partner onboarding, technician category, working city, and confirming that WhatsApp onboarding details are being sent.",
        city ? `- Known city/location: ${city}` : "",
        category ? `- Known category/specialization: ${category}` : "",
        `Partner's latest words: ${String(userText || "").trim()}`,
    ].filter(Boolean).join("\n");
}

function buildPendingProfessionalProviderTurnContext(userText = "", context = {}) {
    const city = String(context.customerLocation || "").trim();
    const category = String(context.sourceCategory || context.sourceRequirement || "").trim();
    const liveCatalogSummary = String(context.liveCatalogSummary || "").trim();
    const verticalCopy = getProfessionalVerticalCopy(getProfessionalContextMeta(context));

    return [
        "Pending professional provider onboarding call reminder:",
        "- This caller is only from the New Professional Requests section.",
        `- Professional vertical: ${verticalCopy.vertical}.`,
        `- Service examples for this vertical: ${verticalCopy.examples}.`,
        `- Ask clearly: ${verticalCopy.askLine}`,
        `- If they confirm yes, tell them to download the Doorstep Hub Partner app and start getting bookings now, then send partner onboarding WhatsApp.`,
        `- Pitch line: ${verticalCopy.pitchLine}`,
        "- Use live professional catalog summary when available. Do not invent unrelated services.",
        liveCatalogSummary
            ? `- Live catalog summary: ${liveCatalogSummary}`
            : "- Live catalog summary: not loaded yet. Call get_live_catalog_snapshot before listing services.",
        "- Never ask if they personally need customer booking help.",
        city ? `- Known city/location: ${city}` : "",
        category ? `- Known category/specialization: ${category}` : "",
        `Professional partner's latest words: ${String(userText || "").trim()}`,
    ].filter(Boolean).join("\n");
}

function buildPendingServiceProviderTurnContext(userText = "", context = {}) {
    const city = String(context.customerLocation || "").trim();
    const category = String(context.sourceCategory || context.sourceRequirement || "").trim();
    const liveCatalogSummary = String(context.liveCatalogSummary || "").trim();

    return [
        "Pending service provider vendor onboarding call reminder:",
        "- This caller is only from the New Providers Request section. They are a vendor or service technician lead.",
        "- Goal: short vendor onboarding pitch. Confirm they are a vendor, explain how joining Doorstep Hub can increase their business with more customer leads, explain home appliance services only using the live catalog, invite them to join, and send partner onboarding WhatsApp.",
        "- Doorstep Hub partner onboarding for this section is home appliance services only. Mention real home appliance categories or services from the live catalog. Never mention plumbing, electrical, or unrelated services unless they appear in the live home-appliance catalog.",
        liveCatalogSummary
            ? `- Live catalog summary: ${liveCatalogSummary}`
            : "- Live catalog summary: not loaded yet. Call get_live_catalog_snapshot before listing services.",
        "- Good questions: Are you a vendor or service technician? Are you interested in onboarding with Doorstep Hub to grow your business?",
        "- Never ask if they personally need appliance repair, home service, booking help, or customer support.",
        city ? `- Known city/location: ${city}` : "",
        category ? `- Known category/specialization: ${category}` : "",
        `Vendor's latest words: ${String(userText || "").trim()}`,
    ].filter(Boolean).join("\n");
}

function buildToolFallbackReply(calls = [], results = [], context = {}) {
    const entries = Array.isArray(calls)
        ? calls.map((call, index) => ({
              name: call?.name || "",
              result: results[index]?.functionResponse?.response || {},
          }))
        : [];

    for (const entry of entries) {
        if (entry.name === "send_whatsapp_message" && entry.result?.success !== false) {
            return isPendingProfessionalProviderContext(context)
                ? "I've sent the Doorstep Hub partner onboarding details to your WhatsApp. If you provide these services, please download the Partner app and start getting bookings now."
                : isPendingServiceProviderContext(context)
                ? "I've sent the Doorstep Hub partner onboarding details to your WhatsApp. Please review them and join our partner network to start receiving home appliance service bookings."
                : isPartnerLeadContext(context)
                ? "I've sent the partner onboarding details to your WhatsApp. Please review them and our team will guide you on the next steps."
                : "I've sent the details to your WhatsApp. Please check them and let me know if you need any help.";
        }
    }

    for (const entry of entries) {
        if (entry.name === "send_payment_link" && entry.result?.success !== false) {
            return "I've sent the payment link to your WhatsApp. Please check it when you are ready.";
        }
        if (entry.name === "schedule_callback" && entry.result?.success !== false) {
            return "I've noted your callback request. Our team will reach out at the suitable time.";
        }
        if (entry.name === "capture_outcome" && entry.result?.success !== false) {
            return isPartnerLeadContext(context)
                ? "Thank you for your time. Our partner onboarding team will follow up with you shortly."
                : "Thank you for your time. Our team will follow up with you shortly.";
        }
    }

    return isPartnerLeadContext(context)
        ? "Thank you. Our partner onboarding team will follow up with you on WhatsApp shortly."
        : "Thank you. Our team will follow up with you shortly.";
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
        let lastCalls = [];
        let lastResponses = [];

        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
            const calls = response.functionCalls || [];
            if (!calls.length) break;
            lastCalls = calls;

            const responses = [];
            for (const call of calls) {
                if (call.name === "escalate_to_human") escalate = true;
                logger.info(`tool call: ${call.name} ${JSON.stringify(call.args || {})}`);
                const result = await actionsService.execute(sessionId, call.name, call.args || {});
                responses.push({
                    functionResponse: { name: call.name, response: result },
                });
            }
            lastResponses = responses;

            response = await chat.sendMessage({ message: responses });
        }

        const finalText = (response.text || "").trim();
        if (finalText) {
            return { text: finalText, escalate };
        }

        if (lastCalls.length) {
            logger.warn("Gemini returned empty text after tool execution; using fallback reply.");
            return { text: buildToolFallbackReply(lastCalls, lastResponses, context), escalate };
        }

        return { text: "", escalate };
    }

    return {
        async reply(userText) {
            try {
                const groundedMessage = isPendingProfessionalProviderContext(context)
                    ? buildPendingProfessionalProviderTurnContext(userText, context)
                    : isPendingServiceProviderContext(context)
                    ? buildPendingServiceProviderTurnContext(userText, context)
                    : isPartnerLeadContext(context)
                    ? buildPartnerLeadTurnContext(userText, context)
                    : await buildPrefightLookupContext(userText, context, sessionId);
                const { text, escalate } = await runTurn(groundedMessage);
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
