const router = require("express").Router();
const { Op } = require("sequelize");
const { Result, Match, Bet } = require("../../models");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { validate, declareResultSchema } = require("../../utils/validation");
const { success, error, paginated } = require("../../utils/apiResponse");
const settlementEngine = require("../../core/settlement.engine");
const AuditLog = require("../../core/audit.engine");

// GET /api/v1/results/pending
router.get("/pending", authenticate, authorize('RESULT:VIEW'), asyncHandler(async (req, res) => {
    const matches = await Match.findAll({
        where: { status: { [Op.in]: ['ACTIVE', 'LIVE', 'COMPLETED'] } },
        include: [{ model: Bet, where: { status: { [Op.in]: ['PENDING', 'OPEN'] } }, required: true }]
    });
    return success(res, matches, "Matches pending result");
}));

// POST /api/v1/results/declare
router.post("/declare", authenticate, authorize('RESULT:DECLARE'), validate(declareResultSchema), asyncHandler(async (req, res) => {
    const { matchId, marketId, winningSelection } = req.body;

    const match = await Match.findByPk(matchId);
    if (!match) return error(res, "Match not found", 404);

    // Create result record
    const result = await Result.create({
        matchId, marketId, winningSelection,
        declaredBy: req.user.id,
        status: 'DECLARED',
        declaredAt: new Date()
    });

    // Settle the match bets
    const settlement = await settlementEngine.settleMatch(matchId, winningSelection, req.user.id);

    // Update match status
    match.status = 'COMPLETED';
    await match.save();

    await AuditLog.create({
        userId: req.user.id, action: "RESULT_DECLARED",
        entity: "Result", entityId: result.id,
        description: `Declared result for match #${matchId}: ${winningSelection}`,
        ipAddress: req.ip
    });

    return success(res, { result, settlement }, "Result declared and bets settled");
}));

// POST /api/v1/results/fancy-declare
router.post("/fancy-declare", authenticate, authorize('RESULT:DECLARE'), asyncHandler(async (req, res) => {
    const { matchId, marketId, winningSelection } = req.body;

    const result = await Result.create({
        matchId, marketId, winningSelection,
        declaredBy: req.user.id, status: 'DECLARED'
    });

    return success(res, result, "Fancy result declared");
}));

// PATCH /api/v1/results/:id/hold
router.patch("/:id/hold", authenticate, authorize('RESULT:HOLD'), asyncHandler(async (req, res) => {
    const result = await Result.findByPk(req.params.id);
    if (!result) return error(res, "Result not found", 404);

    result.status = 'SUSPENDED';
    result.suspendedReason = req.body.reason || null;
    await result.save();

    await AuditLog.create({
        userId: req.user.id, action: "RESULT_SUSPENDED",
        entity: "Result", entityId: result.id, ipAddress: req.ip
    });

    return success(res, null, "Result suspended");
}));

// PATCH /api/v1/results/:id/release
router.patch("/:id/release", authenticate, authorize('RESULT:RELEASE'), asyncHandler(async (req, res) => {
    const result = await Result.findByPk(req.params.id);
    if (!result) return error(res, "Result not found", 404);

    result.status = 'CONFIRMED';
    await result.save();

    return success(res, null, "Result released/confirmed");
}));

// PATCH /api/v1/results/:id/rollback
router.patch("/:id/rollback", authenticate, authorize('RESULT:ROLLBACK'), asyncHandler(async (req, res) => {
    const result = await Result.findByPk(req.params.id);
    if (!result) return error(res, "Result not found", 404);

    result.status = 'ROLLED_BACK';
    result.rolledBackBy = req.user.id;
    result.rolledBackAt = new Date();
    await result.save();

    await AuditLog.create({
        userId: req.user.id, action: "RESULT_ROLLED_BACK",
        entity: "Result", entityId: result.id, ipAddress: req.ip
    });

    return success(res, null, "Result rolled back");
}));

// GET /api/v1/results/suspended
router.get("/suspended", authenticate, authorize('RESULT:VIEW'), asyncHandler(async (req, res) => {
    const results = await Result.findAll({
        where: { status: 'SUSPENDED' },
        include: [{ model: Match }],
        order: [['createdAt', 'DESC']]
    });
    return success(res, results);
}));

// GET /api/v1/results/history
router.get("/history", authenticate, authorize('RESULT:VIEW'), asyncHandler(async (req, res) => {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { count, rows } = await Result.findAndCountAll({
        include: [{ model: Match, attributes: ['id', 'teamA', 'teamB'] }],
        offset: Number(offset), limit: Number(limit),
        order: [['declaredAt', 'DESC']]
    });

    return paginated(res, rows, count, page, limit);
}));

// GET /api/v1/results/:id
router.get("/:id", authenticate, authorize('RESULT:VIEW'), asyncHandler(async (req, res) => {
    const result = await Result.findByPk(req.params.id, { include: [{ model: Match }] });
    if (!result) return error(res, "Result not found", 404);
    return success(res, result);
}));

module.exports = router;
