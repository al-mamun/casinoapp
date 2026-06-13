const router = require("express").Router();
const { Role, Permission, RolePermission } = require("../../models");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { success, error } = require("../../utils/apiResponse");
const permissionCache = require("../../services/permissionCache");
const { getRoleLevel } = require("../../utils/panelHierarchy");
const AuditLog = require("../../core/audit.engine");

const ALL_MODULES = [
    { name: 'DOWNLINE', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'DEPOSIT', 'WITHDRAW'] },
    { name: 'ACCOUNT', actions: ['VIEW', 'EDIT'] },
    { name: 'REPORT', actions: ['VIEW'] },
    { name: 'BETLIST', actions: ['VIEW', 'REJECT', 'CANCEL'] },
    { name: 'RISK', actions: ['VIEW', 'UPDATE'] },
    { name: 'BANKING', actions: ['VIEW', 'DEPOSIT', 'WITHDRAW', 'TRANSFER', 'APPROVE'] },
    { name: 'BANKING_METHOD', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE'] },
    { name: 'MATCH', actions: ['VIEW', 'CREATE', 'EDIT', 'BLOCK', 'CONTROL'] },
    { name: 'RESULT', actions: ['VIEW', 'DECLARE', 'HOLD', 'RELEASE', 'ROLLBACK'] },
    { name: 'SETTINGS', actions: ['VIEW', 'UPDATE'] },
    { name: 'MESSAGE', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE'] },
    { name: 'USER', actions: ['VIEW', 'CREATE', 'EDIT', 'BLOCK', 'DELETE', 'RESTORE'] },
    { name: 'WEBSITE', actions: ['VIEW', 'UPDATE'] },
    { name: 'PRIVILEGES', actions: ['VIEW', 'UPDATE', 'CLONE'] },
    { name: 'SURVEILLANCE', actions: ['VIEW', 'UPDATE'] },
    { name: 'COMPANY_PAYMENT', actions: ['VIEW', 'SETTLE', 'PAYOUT'] },
    { name: 'WHITELABEL', actions: ['VIEW', 'CREATE', 'EDIT', 'LIMIT'] },
    // Section-gate modules — controls which roles can access each User & Access nav section
    { name: 'USER_MANAGEMENT', actions: ['VIEW'] },
    { name: 'ROLE_MANAGEMENT', actions: ['VIEW'] },
    { name: 'USER_ACCESS',     actions: ['VIEW'] },
    { name: 'ACCESS_CONTROL',  actions: ['VIEW'] },
];

// GET /api/v1/permissions/roles
router.get("/roles", authenticate, authorize('PRIVILEGES:VIEW'), asyncHandler(async (req, res) => {
    const roles = await Role.findAll({ order: [['level', 'ASC']] });
    return success(res, roles);
}));

// GET /api/v1/permissions/modules
router.get("/modules", authenticate, authorize('PRIVILEGES:VIEW'), asyncHandler(async (req, res) => {
    return success(res, ALL_MODULES);
}));

// GET /api/v1/permissions/matrix — full matrix for all roles (for the grid UI)
router.get("/matrix", authenticate, authorize('PRIVILEGES:VIEW'), asyncHandler(async (req, res) => {
    const roles = await Role.findAll({ order: [['level', 'ASC']] });
    const requesterLevel = getRoleLevel(req.user.role);

    const matrix = [];
    for (const role of roles) {
        // Only show roles at or below requester's level (OWNER sees all)
        if (req.user.role !== 'OWNER' && role.level <= requesterLevel) continue;

        const permissions = permissionCache.getPermissionsForRole(role.name);
        matrix.push({
            id: role.id,
            name: role.name,
            level: role.level,
            permissions,
            isFullAccess: permissions.includes('*'),
            editable: role.name !== 'OWNER' && (req.user.role === 'OWNER' || role.level > requesterLevel)
        });
    }

    return success(res, { modules: ALL_MODULES, roles: matrix });
}));

// GET /api/v1/permissions/:role
router.get("/:role", authenticate, authorize('PRIVILEGES:VIEW'), asyncHandler(async (req, res) => {
    const roleName = req.params.role;
    const permissions = permissionCache.getPermissionsForRole(roleName);

    if (!permissions) return error(res, "Role not found", 404);

    return success(res, {
        role: roleName,
        permissions,
        isFullAccess: permissions.includes('*')
    });
}));

// PATCH /api/v1/permissions/:role — update permissions for a role
router.patch("/:role", authenticate, authorize('PRIVILEGES:UPDATE'), asyncHandler(async (req, res) => {
    const targetRoleName = req.params.role;
    const { permissions } = req.body; // Array of "MODULE:ACTION" strings

    if (!permissions || !Array.isArray(permissions)) {
        return error(res, "Permissions array required", 400);
    }

    // 1. OWNER protection — cannot modify OWNER
    if (targetRoleName === 'OWNER') {
        return error(res, "Cannot modify OWNER permissions", 403, "OWNER_PROTECTED");
    }

    // 2. Hierarchy enforcement — can only edit roles below your level
    const requesterLevel = getRoleLevel(req.user.role);
    const targetLevel = getRoleLevel(targetRoleName);

    if (req.user.role !== 'OWNER' && targetLevel <= requesterLevel) {
        return error(res, "Cannot edit permissions for a role at or above your level", 403, "HIERARCHY_VIOLATION");
    }

    // 3. Permission ceiling — can only grant permissions you yourself have
    if (req.user.role !== 'OWNER') {
        const myPerms = new Set(permissionCache.getPermissionsForRole(req.user.role));
        for (const perm of permissions) {
            if (!myPerms.has(perm)) {
                return error(res, `Cannot grant permission "${perm}" — you don't have it yourself`, 403, "PERMISSION_CEILING");
            }
        }
    }

    // 4. Find the role in DB
    const role = await Role.findOne({ where: { name: targetRoleName } });
    if (!role) return error(res, "Role not found", 404);

    // 5. Clear existing permissions for this role
    await RolePermission.destroy({ where: { roleId: role.id } });

    // 6. Create new permission entries
    const bulkData = [];
    for (const perm of permissions) {
        const [mod, action] = perm.split(':');
        let permission = await Permission.findOne({ where: { module: mod, action } });
        if (!permission) {
            permission = await Permission.create({ module: mod, action });
        }
        bulkData.push({ roleId: role.id, permissionId: permission.id });
    }

    if (bulkData.length > 0) {
        await RolePermission.bulkCreate(bulkData, { ignoreDuplicates: true });
    }

    // 7. Invalidate cache — changes take effect immediately
    await permissionCache.invalidateRole(targetRoleName);

    // 8. Audit log
    await AuditLog.create({
        userId: req.user.id,
        action: "PERMISSIONS_UPDATED",
        entity: "Role",
        entityId: role.id,
        description: `Updated ${permissions.length} permissions for ${targetRoleName}`,
        ipAddress: req.ip
    });

    return success(res, {
        role: targetRoleName,
        permissionsCount: permissions.length,
        permissions
    }, `Permissions updated for ${targetRoleName}`);
}));

// POST /api/v1/permissions/clone
router.post("/clone", authenticate, authorize('PRIVILEGES:CLONE'), asyncHandler(async (req, res) => {
    const { sourceRole, targetRole } = req.body;

    if (!sourceRole || !targetRole) {
        return error(res, "sourceRole and targetRole required", 400);
    }

    if (targetRole === 'OWNER') {
        return error(res, "Cannot modify OWNER permissions", 403);
    }

    // Hierarchy check
    const requesterLevel = getRoleLevel(req.user.role);
    const targetLevel = getRoleLevel(targetRole);

    if (req.user.role !== 'OWNER' && targetLevel <= requesterLevel) {
        return error(res, "Cannot clone to a role at or above your level", 403);
    }

    // Get source permissions from cache
    const sourcePerms = permissionCache.getPermissionsForRole(sourceRole);
    if (!sourcePerms || sourcePerms.length === 0) {
        return error(res, "Source role has no permissions", 404);
    }

    // Permission ceiling for non-OWNER
    let permsToClone = sourcePerms.filter(p => p !== '*');
    if (req.user.role !== 'OWNER') {
        const myPerms = new Set(permissionCache.getPermissionsForRole(req.user.role));
        permsToClone = permsToClone.filter(p => myPerms.has(p));
    }

    // Find target role in DB
    const targetRoleRecord = await Role.findOne({ where: { name: targetRole } });
    if (!targetRoleRecord) return error(res, "Target role not found", 404);

    // Clear target permissions
    await RolePermission.destroy({ where: { roleId: targetRoleRecord.id } });

    // Copy permissions
    for (const perm of permsToClone) {
        const [mod, action] = perm.split(':');
        let permission = await Permission.findOne({ where: { module: mod, action } });
        if (!permission) {
            permission = await Permission.create({ module: mod, action });
        }
        await RolePermission.findOrCreate({
            where: { roleId: targetRoleRecord.id, permissionId: permission.id }
        });
    }

    // Invalidate cache
    await permissionCache.invalidateRole(targetRole);

    await AuditLog.create({
        userId: req.user.id,
        action: "PERMISSIONS_CLONED",
        entity: "Role",
        entityId: targetRoleRecord.id,
        description: `Cloned ${permsToClone.length} permissions from ${sourceRole} to ${targetRole}`,
        ipAddress: req.ip
    });

    return success(res, {
        sourceRole,
        targetRole,
        clonedCount: permsToClone.length
    }, `Cloned ${permsToClone.length} permissions from ${sourceRole} to ${targetRole}`);
}));

module.exports = router;
