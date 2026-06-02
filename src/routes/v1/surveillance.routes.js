const router = require("express").Router();
const { Op } = require("sequelize");
const { User, Bet } = require("../../models");
const AuditLog = require("../../core/audit.engine");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { success } = require("../../utils/apiResponse");
const reportEngine = require("../../core/report.engine");

// GET /api/v1/surveillance/logs
router.get("/logs", authenticate, authorize('SURVEILLANCE:VIEW'), asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, userId, action } = req.query;
    const offset = (page - 1) * limit;
    const where = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;

    const { count, rows } = await AuditLog.findAndCountAll({
        where,
        include: [{ model: User, attributes: ['id', 'username', 'role'] }],
        offset: Number(offset), limit: Number(limit),
        order: [['createdAt', 'DESC']]
    });

    const { paginated: paginatedFn } = require("../../utils/apiResponse");
    return paginatedFn(res, rows, count, page, limit);
}));

// GET /api/v1/surveillance/multi-login
router.get("/multi-login", authenticate, authorize('SURVEILLANCE:VIEW'), asyncHandler(async (req, res) => {
    const oneHourAgo = new Date(Date.now() - 3600000);
    const logins = await AuditLog.findAll({
        where: { action: 'LOGIN_SUCCESS', createdAt: { [Op.gte]: oneHourAgo } },
        attributes: ['userId', 'ipAddress', 'createdAt'],
        order: [['createdAt', 'DESC']]
    });

    // Group by userId and find multi-IP logins
    const userIPs = {};
    for (const log of logins) {
        if (!userIPs[log.userId]) userIPs[log.userId] = new Set();
        userIPs[log.userId].add(log.ipAddress);
    }

    const multiLogin = Object.entries(userIPs)
        .filter(([, ips]) => ips.size > 1)
        .map(([userId, ips]) => ({ userId: Number(userId), ipCount: ips.size, ips: [...ips] }));

    return success(res, multiLogin, "Multi-login detection");
}));

// GET /api/v1/surveillance/abuse
router.get("/abuse", authenticate, authorize('SURVEILLANCE:VIEW'), asyncHandler(async (req, res) => {
    const oneHourAgo = new Date(Date.now() - 3600000);

    // Rapid betting (>20 bets in 1 hour)
    const rapidBetters = await Bet.findAll({
        where: { createdAt: { [Op.gte]: oneHourAgo } },
        attributes: [
            'userId',
            [require("sequelize").fn('COUNT', require("sequelize").col('id')), 'betCount']
        ],
        group: ['userId'],
        having: require("sequelize").literal('betCount > 20')
    });

    // High stake users (total stake > 100k)
    const highStakers = await Bet.findAll({
        where: { status: { [Op.in]: ['PENDING', 'OPEN'] } },
        attributes: [
            'userId',
            [require("sequelize").fn('SUM', require("sequelize").col('stake')), 'totalStake']
        ],
        group: ['userId'],
        having: require("sequelize").literal('totalStake > 100000')
    });

    return success(res, {
        rapidBetters: rapidBetters.map(b => b.toJSON()),
        highStakers: highStakers.map(b => b.toJSON())
    }, "Abuse detection report");
}));

// GET /api/v1/surveillance/cheat-bets
router.get("/cheat-bets", authenticate, authorize('SURVEILLANCE:VIEW'), asyncHandler(async (req, res) => {
    const bets = await Bet.findAll({
        where: { isCheat: true },
        include: [{ model: User, attributes: ['id', 'username', 'role'] }],
        order: [['createdAt', 'DESC']]
    });
    return success(res, bets);
}));

// GET /api/v1/surveillance/suspicious/:userId
router.get("/suspicious/:userId", authenticate, authorize('SURVEILLANCE:VIEW'), asyncHandler(async (req, res) => {
    const data = await reportEngine.detectSuspiciousActivity(req.params.userId);
    return success(res, data);
}));

// POST /api/v1/surveillance/auto-block/:userId — block user + lock bets
router.post("/auto-block/:userId", authenticate, authorize('SURVEILLANCE:UPDATE'), asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.userId);
    if (!user) return success(res, null, "User not found");

    user.isActive = false;
    user.isBetLocked = true;
    user.status = 'blocked';
    await user.save();

    await AuditLog.create({
        userId: req.user.id,
        action: "USER_AUTO_BLOCKED",
        entity: "User",
        entityId: user.id,
        description: `Auto-blocked user ${user.username}: ${req.body.reason || 'suspicious activity'}`,
        ipAddress: req.ip
    });

    return success(res, null, `User ${user.username} blocked and bet-locked`);
}));

// POST /api/v1/surveillance/unblock/:userId — unblock user
router.post("/unblock/:userId", authenticate, authorize('SURVEILLANCE:UPDATE'), asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.userId);
    if (!user) return success(res, null, "User not found");

    user.isActive = true;
    user.isBetLocked = false;
    user.status = 'active';
    await user.save();

    await AuditLog.create({
        userId: req.user.id,
        action: "USER_UNBLOCKED",
        entity: "User",
        entityId: user.id,
        description: `Unblocked user ${user.username}`,
        ipAddress: req.ip
    });

    return success(res, null, `User ${user.username} unblocked`);
}));

module.exports = router;
