/**
 * Permission Cache Service
 *
 * In-memory cache for role permissions. DB is source of truth.
 * Falls back to hardcoded defaults if DB has no entries for a role.
 */

const { Role, Permission, RolePermission } = require('../models');
const { rolePermissions: hardcodedPermissions } = require('../utils/rolePermissions');
const { normalizeRole } = require('../utils/normalizeRole');

// Cache: Map<roleName, Set<"MODULE:ACTION">>
const cache = new Map();
let initialized = false;

/**
 * Load all role→permission mappings from DB into cache
 */
async function init() {
    try {
        const roles = await Role.findAll({
            include: [{
                model: Permission,
                through: { attributes: [] }
            }]
        });

        cache.clear();

        for (const role of roles) {
            if (role.Permissions && role.Permissions.length > 0) {
                const permSet = new Set();
                for (const perm of role.Permissions) {
                    permSet.add(`${perm.module}:${perm.action}`);
                }
                cache.set(role.name, permSet);
            }
            // If role has 0 permissions in DB, do NOT add to cache
            // → hasPermission will fall through to hardcoded defaults
        }

        initialized = true;
        console.log(`Permission cache loaded: ${cache.size} roles from DB`);
    } catch (err) {
        console.error('Permission cache init failed (using hardcoded fallback):', err.message);
        initialized = false;
    }
}

/**
 * Check if a role has a specific permission
 * @param {string} roleName - e.g. "ADMIN"
 * @param {string} permission - e.g. "DOWNLINE:VIEW"
 * @returns {boolean}
 */
function hasPermission(roleName, permission) {
    // OWNER always has full access
    if (roleName === 'OWNER') return true;

    const [module, action] = permission.split(':');

    // Try cache first (DB-backed permissions)
    if (cache.has(roleName)) {
        const permSet = cache.get(roleName);
        // Check exact match
        if (permSet.has(permission)) return true;
        // Check wildcard module access (e.g. "DOWNLINE:*" in set)
        if (permSet.has(`${module}:*`)) return true;
        // If role is in cache, DB is the authority — deny if not found
        return false;
    }

    // Fallback to hardcoded defaults (role not in cache = never edited via UI)
    return _checkHardcoded(roleName, permission);
}

/**
 * Hardcoded fallback — same logic as the original rolePermissions.js
 */
function _checkHardcoded(roleName, permission) {
    const perms = hardcodedPermissions[roleName];
    if (!perms) return false;
    if (perms.includes('*')) return true;

    const [module, action] = permission.split(':');

    return perms.some(p => {
        const [mod, actions] = p.split(':');
        if (mod !== module) return false;
        if (actions === '*') return true;
        return actions.split(',').includes(action);
    });
}

/**
 * Get all permissions for a role (from cache or hardcoded fallback)
 * @returns {string[]} Array of "MODULE:ACTION" strings
 */
function getPermissionsForRole(roleName) {
    if (roleName === 'OWNER') return ['*'];

    // From cache (DB)
    if (cache.has(roleName)) {
        return Array.from(cache.get(roleName));
    }

    // Fallback: expand hardcoded comma-separated format into individual entries
    const hardcoded = hardcodedPermissions[roleName];
    if (!hardcoded) return [];

    const expanded = [];
    for (const p of hardcoded) {
        if (p === '*') return ['*'];
        const [mod, actions] = p.split(':');
        for (const action of actions.split(',')) {
            expanded.push(`${mod}:${action}`);
        }
    }
    return expanded;
}

/**
 * Invalidate and reload permissions for a single role from DB
 */
async function invalidateRole(roleName) {
    try {
        const role = await Role.findOne({
            where: { name: roleName },
            include: [{
                model: Permission,
                through: { attributes: [] }
            }]
        });

        if (!role) {
            cache.delete(roleName);
            return;
        }

        if (role.Permissions && role.Permissions.length > 0) {
            const permSet = new Set();
            for (const perm of role.Permissions) {
                permSet.add(`${perm.module}:${perm.action}`);
            }
            cache.set(roleName, permSet);
        } else {
            // No DB permissions → remove from cache → fallback to hardcoded
            cache.delete(roleName);
        }

        console.log(`Permission cache refreshed for: ${roleName}`);
    } catch (err) {
        console.error(`Cache invalidation failed for ${roleName}:`, err.message);
    }
}

/**
 * Full reload of all permissions
 */
async function invalidateAll() {
    await init();
}

/**
 * Check if cache is initialized
 */
function isInitialized() {
    return initialized;
}

module.exports = { init, hasPermission, getPermissionsForRole, invalidateRole, invalidateAll, isInitialized };
