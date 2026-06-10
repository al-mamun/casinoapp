const router = require("express").Router();
const { Op } = require("sequelize");
const { Match, Market, League, Bet } = require("../../models");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { validate, createMatchSchema, createMarketSchema } = require("../../utils/validation");
const { success, error, paginated } = require("../../utils/apiResponse");
const AuditLog = require("../../core/audit.engine");
const settlementEngine = require("../../core/settlement.engine");

// GET /api/v1/matches — list all matches
router.get("/", authenticate, asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;
    const where = {};
    if (status) where.status = status;

    const { count, rows } = await Match.findAndCountAll({
        where,
        include: [
            { model: League, attributes: ['id', 'name', 'country'] },
            { model: Market }
        ],
        offset: Number(offset), limit: Number(limit),
        order: [['startTime', 'DESC']]
    });

    return paginated(res, rows, count, page, limit);
}));

// POST /api/v1/matches — create match
router.post("/", authenticate, authorize('MATCH:CREATE'), validate(createMatchSchema), asyncHandler(async (req, res) => {
    const { teamA, teamB, leagueId, startTime, status, sport, venue } = req.body;
    const match = await Match.create({ teamA, teamB, leagueId, startTime, status, sport, venue, isManual: true });

    await AuditLog.create({
        userId: req.user.id, action: "MATCH_CREATED",
        entity: "Match", entityId: match.id,
        description: `Created match: ${req.body.teamA} vs ${req.body.teamB}`, ipAddress: req.ip
    });

    return success(res, match, "Match created", 201);
}));

// PATCH /api/v1/matches/:id — update match
router.patch("/:id", authenticate, authorize('MATCH:EDIT'), asyncHandler(async (req, res) => {
    const match = await Match.findByPk(req.params.id);
    if (!match) return error(res, "Match not found", 404);

    const { teamA, teamB, leagueId, startTime, status, sport, venue } = req.body;
    await match.update({ teamA, teamB, leagueId, startTime, status, sport, venue });
    return success(res, match, "Match updated");
}));

// PATCH /api/v1/matches/:id/status — change match status
router.patch("/:id/status", authenticate, authorize('MATCH:CONTROL'), asyncHandler(async (req, res) => {
    const match = await Match.findByPk(req.params.id);
    if (!match) return error(res, "Match not found", 404);

    match.status = req.body.status;
    await match.save();

    await AuditLog.create({
        userId: req.user.id, action: "MATCH_STATUS_CHANGED",
        entity: "Match", entityId: match.id,
        description: `Match status: ${req.body.status}`, ipAddress: req.ip
    });

    return success(res, match, `Match status changed to ${req.body.status}`);
}));

// GET /api/v1/matches/markets — all markets
router.get("/markets", authenticate, authorize('MATCH:VIEW'), asyncHandler(async (req, res) => {
    const markets = await Market.findAll({
        include: [{ model: Match, attributes: ['id', 'teamA', 'teamB', 'status'] }],
        order: [['createdAt', 'DESC']]
    });
    return success(res, markets);
}));

// PATCH /api/v1/matches/markets/:id/block
router.patch("/markets/:id/block", authenticate, authorize('MATCH:BLOCK'), asyncHandler(async (req, res) => {
    const market = await Market.findByPk(req.params.id);
    if (!market) return error(res, "Market not found", 404);

    market.status = false;
    market.isSuspended = true;
    await market.save();

    await AuditLog.create({
        userId: req.user.id, action: "MARKET_BLOCKED",
        entity: "Market", entityId: market.id, ipAddress: req.ip
    });

    return success(res, null, "Market blocked");
}));

// PATCH /api/v1/matches/markets/:id/unblock
router.patch("/markets/:id/unblock", authenticate, authorize('MATCH:BLOCK'), asyncHandler(async (req, res) => {
    const market = await Market.findByPk(req.params.id);
    if (!market) return error(res, "Market not found", 404);

    market.status = true;
    market.isSuspended = false;
    await market.save();

    return success(res, null, "Market unblocked");
}));

// POST /api/v1/matches/:id/markets — add market to match
router.post("/:id/markets", authenticate, authorize('MATCH:CREATE'), validate(createMarketSchema), asyncHandler(async (req, res) => {
    const match = await Match.findByPk(req.params.id);
    if (!match) return error(res, "Match not found", 404);

    const market = await Market.create({ ...req.body, matchId: match.id });
    return success(res, market, "Market added", 201);
}));

// GET /api/v1/matches/fancy — fancy markets
router.get("/fancy", authenticate, authorize('MATCH:VIEW'), asyncHandler(async (req, res) => {
    const markets = await Market.findAll({
        where: { type: 'FANCY' },
        include: [{ model: Match, attributes: ['id', 'teamA', 'teamB'] }]
    });
    return success(res, markets);
}));

// PATCH /api/v1/matches/fancy/:id/status
router.patch("/fancy/:id/status", authenticate, authorize('MATCH:CONTROL'), asyncHandler(async (req, res) => {
    const market = await Market.findByPk(req.params.id);
    if (!market) return error(res, "Market not found", 404);

    market.isSuspended = !market.isSuspended;
    await market.save();

    return success(res, { isSuspended: market.isSuspended }, `Fancy market ${market.isSuspended ? 'suspended' : 'opened'}`);
}));

// POST /api/v1/matches/settle — settle match
router.post("/settle", authenticate, authorize('RESULT:DECLARE'), asyncHandler(async (req, res) => {
    const { matchId, winningSelection } = req.body;

    const match = await Match.findByPk(matchId);
    if (!match) return error(res, "Match not found", 404);

    const result = await settlementEngine.settleMatch(matchId, winningSelection, req.user.id);

    match.status = 'COMPLETED';
    await match.save();

    return success(res, result, "Match settled successfully");
}));

// GET /api/v1/matches/leagues
router.get("/leagues", authenticate, asyncHandler(async (req, res) => {
    const leagues = await League.findAll({ order: [['name', 'ASC']] });
    return success(res, leagues);
}));

// POST /api/v1/matches/leagues
router.post("/leagues", authenticate, authorize('MATCH:CREATE'), asyncHandler(async (req, res) => {
    const { name, country, sport, logoUrl } = req.body;
    const league = await League.create({ name, country, sport, logoUrl });
    return success(res, league, "League created", 201);
}));

module.exports = router;
