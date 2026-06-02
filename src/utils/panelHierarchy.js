const panelHierarchy = {
    OWNER: { next: "MOTHER_PANEL", label: "Add Mother Panel", level: 1 },
    MOTHER_PANEL: { next: "WHITE_LABEL", label: "Add White Label", level: 2 },
    WHITE_LABEL: { next: "SUPER_ADMIN", label: "Add Super Admin", level: 3 },
    SUPER_ADMIN: { next: "ADMIN", label: "Add Admin", level: 4 },
    ADMIN: { next: ["B2C_SUB_ADMIN", "B2B_SUB_ADMIN"], label: "Add Sub Admin (B2C / B2B)", level: 5 },
    B2C_SUB_ADMIN: { next: "SENIOR_AFFILIATE", label: "Add Senior Affiliate", level: 6 },
    SENIOR_AFFILIATE: { next: "AFFILIATE", label: "Add Affiliate", level: 7 },
    AFFILIATE: { next: "PLAYER", label: "Add Player (Referral)", level: 8 },
    B2B_SUB_ADMIN: { next: "SUPER_AGENT", label: "Add Super Agent", level: 9 },
    SUPER_AGENT: { next: "MASTER_AGENT", label: "Add Master Agent", level: 10 },
    MASTER_AGENT: { next: "AGENT", label: "Add Agent", level: 11 },
    AGENT: { next: "PLAYER", label: "Add Player", level: 12 },
    PLAYER: { next: null, label: null, level: 13 }
};

// Check if a role can create the target role
function canCreate(creatorRole, targetRole) {
    const config = panelHierarchy[creatorRole];
    if (!config || !config.next) return false;

    if (Array.isArray(config.next)) {
        return config.next.includes(targetRole);
    }
    return config.next === targetRole;
}

// Get all roles below a given role in the hierarchy
function getDownlineRoles(role) {
    const currentLevel = panelHierarchy[role]?.level || 0;
    return Object.entries(panelHierarchy)
        .filter(([, v]) => v.level > currentLevel)
        .map(([k]) => k);
}

// Get role level
function getRoleLevel(role) {
    return panelHierarchy[role]?.level || 99;
}

module.exports = { panelHierarchy, canCreate, getDownlineRoles, getRoleLevel };
