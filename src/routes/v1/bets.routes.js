const router = require("express").Router();
const { Op } = require("sequelize");
const sequelize = require("../../config/sequelize.db");
const { Bet, Match, Market, User, Wallet, Transaction, PlayerStats } = require("../../models");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { validate, placeBetSchema } = require("../../utils/validation");
const { success, error, paginated } = require("../../utils/apiResponse");
const riskEngine = require("../../core/risk.engine");
const AuditLog = require("../../core/audit.engine");

// GET /api/v1/bets — list bets (filtered)
router.get("/", authenticate, authorize('BETLIST:VIEW'), asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status, userId, matchId } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;
    if (userId) where.userId = userId;
    if (matchId) where.matchId = matchId;

    const { count, rows } = await Bet.findAndCountAll({
        where,
        include: [
            { model: User, attributes: ['id', 'username', 'role'] },
            { model: Match, attributes: ['id', 'teamA', 'teamB', 'status'] }
        ],
        offset: Number(offset), limit: Number(limit),
        order: [['createdAt', 'DESC']]
    });

    return paginated(res, rows, count, page, limit);
}));

// GET /api/v1/bets/live — live running bets
router.get("/live", authenticate, authorize('BETLIST:VIEW'), asyncHandler(async (req, res) => {
    const bets = await Bet.findAll({
        where: { status: { [Op.in]: ['PENDING', 'OPEN'] } },
        include: [
            { model: User, attributes: ['id', 'username', 'role'] },
            { model: Match, attributes: ['id', 'teamA', 'teamB', 'status'] }
        ],
        order: [['createdAt', 'DESC']],
        limit: 100
    });
    return success(res, bets);
}));

// GET /api/v1/bets/live/exposure
router.get("/live/exposure", authenticate, authorize('BETLIST:VIEW'), asyncHandler(async (req, res) => {
    const exposureEngine = require("../../core/exposure.engine");
    const data = await exposureEngine.getAllMatchExposures();
    return success(res, data);
}));

// GET /api/v1/bets/live/risk
router.get("/live/risk", authenticate, authorize('RISK:VIEW'), asyncHandler(async (req, res) => {
    const data = await riskEngine.getRiskData();
    return success(res, data);
}));

// GET /api/v1/bets/risk-summary
router.get("/risk-summary", authenticate, authorize('RISK:VIEW'), asyncHandler(async (req, res) => {
    const riskData = await riskEngine.getRiskData();
    const criticalMatches = await riskEngine.getCriticalMatches();
    const topExposed = await riskEngine.getTopExposedUsers(10);

    return success(res, { ...riskData, criticalMatches, topExposedUsers: topExposed });
}));

// GET /api/v1/bets/cheat — suspicious bets
router.get("/cheat", authenticate, authorize('BETLIST:VIEW'), asyncHandler(async (req, res) => {
    const bets = await Bet.findAll({
        where: { isCheat: true },
        include: [{ model: User, attributes: ['id', 'username', 'role'] }],
        order: [['createdAt', 'DESC']]
    });
    return success(res, bets);
}));

// GET /api/v1/bets/:id
router.get("/:id", authenticate, authorize('BETLIST:VIEW'), asyncHandler(async (req, res) => {
    const bet = await Bet.findByPk(req.params.id, {
        include: [
            { model: User, attributes: ['id', 'username', 'role'] },
            { model: Match }
        ]
    });
    if (!bet) return error(res, "Bet not found", 404);
    return success(res, bet);
}));

// POST /api/v1/bets/place — place a new bet
router.post("/place", authenticate, validate(placeBetSchema), asyncHandler(async (req, res) => {
    const { matchId, marketId, selection, odds, stake } = req.body;

    // Check if user is bet locked
    const user = await User.findByPk(req.user.id);
    if (user.isBetLocked) return error(res, "Your betting is locked", 403, "BET_LOCKED");

    // Check match is active
    const match = await Match.findByPk(matchId);
    if (!match || !['ACTIVE', 'LIVE'].includes(match.status)) {
        return error(res, "Match is not available for betting", 400);
    }

    // Check market
    if (marketId) {
        const market = await Market.findByPk(marketId);
        if (!market || !market.status || market.isSuspended) {
            return error(res, "Market is closed or suspended", 400);
        }
    }

    // Risk validation
    const riskCheck = await riskEngine.validateBetRisk(req.user.id, matchId, stake, odds);
    if (!riskCheck.allowed) return error(res, riskCheck.reason, 400, "RISK_LIMIT");

    // Check wallet balance
    const wallet = await Wallet.findOne({ where: { userId: req.user.id } });
    if (Number(wallet.balance) < stake) return error(res, "Insufficient balance", 400, "INSUFFICIENT_BALANCE");

    const t = await sequelize.transaction();
    try {
        const potentialWin = stake * odds;
        const liability = (odds - 1) * stake;
        const balanceBefore = Number(wallet.balance);

        // Deduct stake
        wallet.balance = Number(wallet.balance) - stake;
        await wallet.save({ transaction: t });

        // Create bet
        const bet = await Bet.create({
            userId: req.user.id, matchId, marketId, selection, odds, stake,
            potentialWin, liability, status: 'OPEN'
        }, { transaction: t });

        // Transaction record
        await Transaction.create({
            userId: req.user.id, type: 'BET_PLACED', amount: stake,
            balanceBefore, balanceAfter: Number(wallet.balance),
            referenceId: String(bet.id), referenceType: 'BET',
            description: `Bet placed on match #${matchId}`
        }, { transaction: t });

        // Update player stats
        const stats = await PlayerStats.findOne({ where: { userId: req.user.id } });
        if (stats) {
            stats.totalBets = (stats.totalBets || 0) + 1;
            stats.totalStake = Number(stats.totalStake || 0) + stake;
            stats.lastBetAt = new Date();
            await stats.save({ transaction: t });
        }

        await AuditLog.create({
            userId: req.user.id, action: "BET_PLACED",
            entity: "Bet", entityId: bet.id, amount: stake,
            description: `Bet on match #${matchId}, selection: ${selection}, odds: ${odds}`,
            ipAddress: req.ip
        }, { transaction: t });

        await t.commit();
        return success(res, bet, "Bet placed successfully", 201);
    } catch (err) {
        await t.rollback();
        throw err;
    }
}));

// PATCH /api/v1/bets/:id/reject
router.patch("/:id/reject", authenticate, authorize('BETLIST:REJECT'), asyncHandler(async (req, res) => {
    const bet = await Bet.findByPk(req.params.id);
    if (!bet) return error(res, "Bet not found", 404);
    if (!['PENDING', 'OPEN'].includes(bet.status)) return error(res, "Bet cannot be rejected", 400);

    const t = await sequelize.transaction();
    try {
        bet.status = 'REJECTED';
        await bet.save({ transaction: t });

        // Refund stake
        const wallet = await Wallet.findOne({ where: { userId: bet.userId }, transaction: t });
        const balanceBefore = Number(wallet.balance);
        wallet.balance = Number(wallet.balance) + Number(bet.stake);
        await wallet.save({ transaction: t });

        await Transaction.create({
            userId: bet.userId, type: 'REFUND', amount: Number(bet.stake),
            balanceBefore, balanceAfter: Number(wallet.balance),
            referenceId: String(bet.id), referenceType: 'BET',
            description: `Bet #${bet.id} rejected and refunded`
        }, { transaction: t });

        await t.commit();
        return success(res, null, "Bet rejected and refunded");
    } catch (err) {
        await t.rollback();
        throw err;
    }
}));

// PATCH /api/v1/bets/:id/mark-cheat
router.patch("/:id/mark-cheat", authenticate, authorize('BETLIST:VIEW'), asyncHandler(async (req, res) => {
    const bet = await Bet.findByPk(req.params.id);
    if (!bet) return error(res, "Bet not found", 404);

    bet.isCheat = true;
    bet.cheatReason = req.body.reason || 'Marked as suspicious';
    await bet.save();

    return success(res, null, "Bet marked as cheat");
}));

// GET /api/v1/bets/user/my-bets
router.get("/user/my-bets", authenticate, asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;
    const where = { userId: req.user.id };
    if (status) where.status = status;

    const { count, rows } = await Bet.findAndCountAll({
        where,
        include: [{ model: Match, attributes: ['id', 'teamA', 'teamB', 'status'] }],
        offset: Number(offset), limit: Number(limit),
        order: [['createdAt', 'DESC']]
    });

    return paginated(res, rows, count, page, limit);
}));

module.exports = router;
