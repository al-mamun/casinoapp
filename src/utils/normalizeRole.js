function normalizeRole(role) {
    return String(role || "").trim().replace(/\s+/g, "_").toUpperCase();
}

module.exports = { normalizeRole };
