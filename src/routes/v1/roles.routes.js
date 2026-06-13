const router = require("express").Router();
const { Op } = require("sequelize");
const { Role, Permission, RolePermission, User } = require("../../models");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { success, error } = require("../../utils/apiResponse");
const permissionCache = require("../../services/permissionCache");
const AuditLog = require("../../core/audit.engine");

// All predefined roles with labels, levels, colors
const DEFAULT_ROLES = [
    { name: "OWNER",           label: "Owner",           level: 1,  color: "#f59e0b" },
    { name: "MOTHER_PANEL",    label: "Mother Panel",    level: 2,  color: "#8b5cf6" },
    { name: "WHITE_LABEL",     label: "White Label",     level: 3,  color: "#3b82f6" },
    { name: "SUPER_ADMIN",     label: "Super Admin",     level: 4,  color: "#06b6d4" },
    { name: "ADMIN",           label: "Admin",           level: 5,  color: "#10b981" },
    { name: "B2C_SUB_ADMIN",   label: "B2C Sub Admin",   level: 6,  color: "#2cb494" },
    { name: "B2B_SUB_ADMIN",   label: "B2B Sub Admin",   level: 7,  color: "#14b8a6" },
    { name: "SENIOR_AFFILIATE",label: "Senior Affiliate",level: 8,  color: "#f97316" },
    { name: "AFFILIATE",       label: "Affiliate",       level: 9,  color: "#ef4444" },
    { name: "SUPER_AGENT",     label: "Super Agent",     level: 10, color: "#a855f7" },
    { name: "MASTER_AGENT",    label: "Master Agent",    level: 11, color: "#ec4899" },
    { name: "AGENT",           label: "Agent",           level: 12, color: "#64748b" },
    { name: "PLAYER",          label: "Player",          level: 13, color: "#6b7280" },
];

/**
 * Seed default roles into DB if they don't exist.
 * Called on startup.
 */
async function seedRoles() {
    try {
        for (const r of DEFAULT_ROLES) {
            const existing = await Role.findOne({ where: { name: r.name } });
            if (!existing) {
                await Role.create({ name: r.name, level: r.level });
                console.log(`[roles] Seeded role: ${r.name}`);
            }
        }
    } catch (err) {
        console.warn("[roles] Seed failed:", err.message);
    }
}

// GET /api/v1/roles — list all roles with user counts and permission count
router.get("/", authenticate, authorize("PRIVILEGES:VIEW"), asyncHandler(async (req, res) => {
    let roles = await Role.findAll({ order: [["level", "ASC"]] });
    // Lazy seed: runs on Vercel where startServer() is skipped
    if (roles.length === 0) {
        await seedRoles();
        roles = await Role.findAll({ order: [["level", "ASC"]] });
    }

    // Attach user counts per role
    const roleCounts = {};
    try {
        const counts = await User.findAll({
            where: { isDeleted: false },
            attributes: ["role"],
            raw: true
        });
        counts.forEach(u => {
            const r = String(u.role || "").toUpperCase();
            roleCounts[r] = (roleCounts[r] || 0) + 1;
        });
    } catch (_) {}

    const data = roles.map(r => {
        const meta = DEFAULT_ROLES.find(d => d.name === r.name) || {};
        const perms = permissionCache.getPermissionsForRole(r.name);
        return {
            id: r.id,
            name: r.name,
            label: meta.label || r.name,
            level: r.level,
            color: meta.color || "#6b7280",
            userCount: roleCounts[r.name] || 0,
            permissionCount: perms.includes("*") ? "ALL" : perms.length,
            permissions: perms,
            isSystem: DEFAULT_ROLES.some(d => d.name === r.name),
        };
    });

    return success(res, data);
}));

// POST /api/v1/roles — create a new role (OWNER only)
router.post("/", authenticate, authorize("OWNER_ONLY"), asyncHandler(async (req, res) => {
    const { name, level } = req.body;
    if (!name || !level) return error(res, "name and level are required", 400);

    const normalized = String(name).toUpperCase().replace(/\s+/g, "_").replace(/[^A-Z0-9_]/g, "");
    if (!normalized) return error(res, "Invalid role name", 400);

    const existing = await Role.findOne({ where: { name: normalized } });
    if (existing) return error(res, `Role ${normalized} already exists`, 409);

    const role = await Role.create({ name: normalized, level: Number(level) });

    await AuditLog.create({
        userId: req.user.id, action: "ROLE_CREATED", entity: "Role",
        entityId: role.id, description: `Created role: ${normalized}`, ipAddress: req.ip
    });

    return success(res, { id: role.id, name: normalized, level: Number(level) }, "Role created");
}));

// PATCH /api/v1/roles/:id — update role level (cannot rename system roles)
router.patch("/:id", authenticate, authorize("OWNER_ONLY"), asyncHandler(async (req, res) => {
    const role = await Role.findOne({ where: { id: Number(req.params.id) } });
    if (!role) return error(res, "Role not found", 404);
    if (role.name === "OWNER") return error(res, "Cannot modify OWNER role", 403);

    const { level } = req.body;
    if (level !== undefined) role.level = Number(level);

    await role.save();

    await AuditLog.create({
        userId: req.user.id, action: "ROLE_UPDATED", entity: "Role",
        entityId: role.id, description: `Updated role: ${role.name}`, ipAddress: req.ip
    });

    return success(res, { id: role.id, name: role.name, level: role.level }, "Role updated");
}));

// DELETE /api/v1/roles/:id — delete role only if no users assigned
router.delete("/:id", authenticate, authorize("OWNER_ONLY"), asyncHandler(async (req, res) => {
    const role = await Role.findOne({ where: { id: Number(req.params.id) } });
    if (!role) return error(res, "Role not found", 404);
    if (role.name === "OWNER") return error(res, "Cannot delete OWNER role", 403);
    if (DEFAULT_ROLES.some(d => d.name === role.name)) {
        return error(res, "Cannot delete a system role", 403);
    }

    // Check if any users have this role
    const userCount = await User.count({ where: { role: role.name, isDeleted: { $ne: true } ?? false } });
    if (userCount > 0) {
        return error(res, `Cannot delete — ${userCount} user(s) still have this role`, 409);
    }

    // Remove role permissions
    await RolePermission.destroy({ where: { roleId: role.id } });
    await role.destroy();

    permissionCache.invalidateRole(role.name);

    await AuditLog.create({
        userId: req.user.id, action: "ROLE_DELETED", entity: "Role",
        entityId: role.id, description: `Deleted role: ${role.name}`, ipAddress: req.ip
    });

    return success(res, null, "Role deleted");
}));

module.exports = router;
module.exports.seedRoles = seedRoles;
