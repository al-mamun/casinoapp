const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { normalizeRole } = require("../utils/normalizeRole");

const JWT_SECRET = process.env.JWT_SECRET || 'SUPER_SECRET_KEY_123';

// Main auth middleware — verifies JWT token + session validation
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: "Authentication required", errorCode: "UNAUTHORIZED" });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const fullAccessMode = !!decoded.fullAccessMode;
        const disableRbac = String(process.env.DISABLE_RBAC || (process.env.NODE_ENV !== "production" ? "true" : "false")).toLowerCase() === "true";
        const effectiveRole = disableRbac ? "OWNER" : (fullAccessMode ? "OWNER" : normalizeRole(decoded.role));

        req.user = {
            ...decoded,
            actualRole: normalizeRole(decoded.role),
            scopeRole: normalizeRole(decoded.role),
            role: effectiveRole,
            effectiveRole,
            reviewMode: !!decoded.reviewMode,
            fullAccessMode: disableRbac ? true : fullAccessMode
        };
        req.token = token;

        // Check if session is still active (lightweight check)
        try {
            const { Session } = require("../models");
            const tokenHash = hashToken(token);
            const session = await Session.findOne({
                where: { tokenHash, userId: decoded.id, isActive: true }
            });

            if (!session) {
                // Session not found — could be old token before session tracking was added
                // Allow it through for backward compatibility
                return next();
            }

            // Update last activity
            session.lastActivityAt = new Date();
            await session.save();
        } catch (sessionErr) {
            // Session table might not exist yet — skip check
        }

        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: "Token expired", errorCode: "TOKEN_EXPIRED" });
        }
        return res.status(401).json({ success: false, message: "Invalid token", errorCode: "INVALID_TOKEN" });
    }
};

// Generate JWT token
const generateToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            role: normalizeRole(user.role),
            roleId: user.roleId,
            reviewMode: !!user.reviewMode,
            fullAccessMode: !!user.fullAccessMode
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
};

// Hash token for storage (don't store raw JWT in DB)
const hashToken = (token) => {
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 64);
};

// Create session record on login
const createSession = async (userId, token, ip, userAgent) => {
    try {
        const { Session, User, SystemSettings } = require("../models");
        const tokenHash = hashToken(token);

        // Check concurrent session limit
        const user = await User.findByPk(userId);
        const globalLimit = await SystemSettings.findOne({ where: { key: 'max_concurrent_sessions' } });
        const maxSessions = user?.maxConcurrentSessions || (globalLimit ? Number(JSON.parse(globalLimit.value)) : 3);

        const activeSessions = await Session.count({
            where: { userId, isActive: true }
        });

        // If over limit, deactivate oldest sessions
        if (activeSessions >= maxSessions) {
            const oldest = await Session.findAll({
                where: { userId, isActive: true },
                order: [['createdAt', 'ASC']],
                limit: activeSessions - maxSessions + 1
            });
            for (const s of oldest) {
                s.isActive = false;
                await s.save();
            }
        }

        // Create new session
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        await Session.create({ userId, tokenHash, ipAddress: ip, userAgent, expiresAt });

        return { success: true, activeSessions: Math.min(activeSessions + 1, maxSessions) };
    } catch (err) {
        // Session table might not exist — skip silently
        return { success: false };
    }
};

// Get active sessions for a user
const getActiveSessions = async (userId) => {
    try {
        const { Session } = require("../models");
        return await Session.findAll({
            where: { userId, isActive: true },
            attributes: ['id', 'ipAddress', 'userAgent', 'lastActivityAt', 'createdAt'],
            order: [['lastActivityAt', 'DESC']]
        });
    } catch (err) {
        return [];
    }
};

// Logout — deactivate session
const destroySession = async (token) => {
    try {
        const { Session } = require("../models");
        const tokenHash = hashToken(token);
        await Session.update({ isActive: false }, { where: { tokenHash } });
    } catch (err) { /* skip */ }
};

// Verify token without middleware
const verifyToken = (token) => {
    return jwt.verify(token, JWT_SECRET);
};

module.exports = { authenticate, generateToken, verifyToken, hashToken, createSession, getActiveSessions, destroySession };
