"use strict";

function normalizeText(value = "") {
    return String(value || "").trim().toLowerCase();
}

function buildDetectionHaystack(meta = {}) {
    return [
        meta.sourceServiceName,
        meta.serviceName,
        meta.sourceCategory,
        meta.category,
        meta.sourceRequirement,
        meta.requirement,
        meta.sourceRemarks,
        meta.remarks,
    ]
        .map(normalizeText)
        .filter(Boolean)
        .join(" ");
}

function detectProfessionalVertical(meta = {}) {
    const haystack = buildDetectionHaystack(meta);

    if (/\b(religious|religion|pooja|puja|homa|homam|ritual|priest|temple|astrology|parihara)\b/.test(haystack)) {
        return "religious";
    }
    if (/\b(spa|salon|saloon|beauty|grooming|pedicure|manicure|facial|hair|dog|pet|breeding)\b/.test(haystack)) {
        return "spa_salon";
    }
    if (/\b(pg|hostel|stay|staying|accommodation|lodging|coliving|room rent|paying guest)\b/.test(haystack)) {
        return "pg_hostel";
    }
    return "general";
}

const VERTICAL_COPY = {
    religious: {
        examples: "poojas, homas, and pooja rituals",
        askLine: "Are you providing religious services like poojas, homas, and pooja rituals?",
        pitchLine:
            "Doorstep Hub helps professional partners receive bookings for religious services such as poojas, homas, and pooja rituals.",
        closeLine:
            "If yes, please download the Doorstep Hub Partner app and start getting bookings now. We are sending the onboarding details on WhatsApp.",
    },
    spa_salon: {
        examples: "women's pedicure, men's pedicure, and pet grooming services",
        askLine:
            "Are you providing spa and salon services like women's pedicure, men's pedicure, and pet grooming?",
        pitchLine:
            "Doorstep Hub helps professional partners receive bookings for spa and salon services such as women's pedicure, men's pedicure, and pet grooming.",
        closeLine:
            "If yes, please download the Doorstep Hub Partner app and start getting bookings now. We are sending the onboarding details on WhatsApp.",
    },
    pg_hostel: {
        examples: "PG stays, hostel stays, and nearby accommodation",
        askLine: "Are you providing PG, hostel, or nearby staying services?",
        pitchLine:
            "Doorstep Hub helps professional partners receive bookings for PG, hostel, and nearby staying services.",
        closeLine:
            "If yes, please download the Doorstep Hub Partner app and start getting bookings now. We are sending the onboarding details on WhatsApp.",
    },
    general: {
        examples: "your listed professional services",
        askLine: "Are you providing the professional services listed with Doorstep Hub?",
        pitchLine: "Doorstep Hub helps professional partners receive more customer bookings for their services.",
        closeLine:
            "If yes, please download the Doorstep Hub Partner app and start getting bookings now. We are sending the onboarding details on WhatsApp.",
    },
};

function getProfessionalVerticalCopy(meta = {}) {
    const vertical = detectProfessionalVertical(meta);
    return { vertical, ...VERTICAL_COPY[vertical] };
}

const HOME_APPLIANCE_PATTERN =
    /\b(appliance|home appliance|ac|air conditioner|refrigerator|fridge|washing machine|microwave|oven|geyser|television|tv|cooler|dishwasher|dryer|ro|water purifier)\b/i;

function filterHomeApplianceItems(items = []) {
    return items.filter((item) => HOME_APPLIANCE_PATTERN.test(String(item || "")));
}

function formatHomeApplianceCatalogPitch(snapshot = {}) {
    const categories = filterHomeApplianceItems(snapshot.categories || []).slice(0, 6);
    const subcategories = filterHomeApplianceItems(snapshot.subcategories || []).slice(0, 6);
    const services = filterHomeApplianceItems(snapshot.services || []).slice(0, 6);

    if (categories.length || subcategories.length || services.length) {
        const parts = [];
        if (categories.length) parts.push(`home appliance categories like ${categories.join(", ")}`);
        if (subcategories.length) parts.push(`repairs such as ${subcategories.join(", ")}`);
        if (services.length) parts.push(`services like ${services.join(", ")}`);
        return `Doorstep Hub partner onboarding is focused on home appliance services only, including ${parts.join(", ")}.`;
    }

    return "Doorstep Hub partner onboarding is focused on home appliance repair and related appliance services only.";
}

module.exports = {
    detectProfessionalVertical,
    getProfessionalVerticalCopy,
    formatHomeApplianceCatalogPitch,
    filterHomeApplianceItems,
};
