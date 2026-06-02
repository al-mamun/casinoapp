/**
 * Hierarchy Service
 * Recursively resolves downline user IDs for data isolation
 */

const { User } = require('../models');

// Cache to avoid repeated DB queries within same request cycle
const _cache = new Map();
const CACHE_TTL = 60000; // 1 minute

/**
 * Get ALL user IDs in a user's full downline tree (recursive)
 * @param {number} userId
 * @returns {Promise<number[]>} Array of user IDs (does NOT include the userId itself)
 */
async function getFullDownlineIds(userId) {
    const cacheKey = `dl_${userId}`;
    const cached = _cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.ids;

    const ids = [];
    const queue = [userId];

    while (queue.length > 0) {
        const parentId = queue.shift();
        const children = await User.findAll({
            where: { parentId, isDeleted: false },
            attributes: ['id'],
            raw: true
        });

        for (const child of children) {
            ids.push(child.id);
            queue.push(child.id);
        }
    }

    _cache.set(cacheKey, { ids, ts: Date.now() });
    return ids;
}

/**
 * Check if targetUserId is in the caller's downline tree
 * @param {number} callerId
 * @param {number} targetUserId
 * @param {string} callerRole
 * @returns {Promise<boolean>}
 */
async function isInDownline(callerId, targetUserId, callerRole) {
    if (callerRole === 'OWNER') return true;
    if (callerId === targetUserId) return true;

    const downlineIds = await getFullDownlineIds(callerId);
    return downlineIds.includes(Number(targetUserId));
}

/**
 * Clear cache for a user (call after user creation/deletion)
 */
function clearCache(userId) {
    _cache.delete(`dl_${userId}`);
}

module.exports = { getFullDownlineIds, isInDownline, clearCache };
