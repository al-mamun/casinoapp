const router = require("express").Router();
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { success, error } = require("../../utils/apiResponse");
const reportEngine = require("../../core/report.engine");
const commissionEngine = require("../../core/commission.engine");
const { Transaction } = require("../../models");
const { isInDownline } = require("../../services/hierarchyService");

function isOwnerRole(role) {
    return String(role || "").trim().toUpperCase() === "OWNER";
}

router.get("/my-summary", authenticate, asyncHandler(async (req, res) => {
    const report = await reportEngine.getUserReport(req.user.id);
    return success(res, report, "My report summary");
}));

router.get("/my-turnover", authenticate, asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    const data = await reportEngine.getTurnoverReport(req.user.id, startDate, endDate);
    return success(res, data, "My turnover");
}));

router.get("/my-commission", authenticate, asyncHandler(async (req, res) => {
    const total = await commissionEngine.getUserCommissions(req.user.id);
    const { startDate, endDate } = req.query;
    const history = await commissionEngine.getCommissionsByPeriod(req.user.id, startDate, endDate);
    return success(res, { total, history }, "My commissions");
}));

router.get("/my-profit-loss", authenticate, asyncHandler(async (req, res) => {
    const report = await reportEngine.getUserReport(req.user.id);
    return success(res, {
        totalStake: report.totalStake,
        totalPayout: report.totalPayout,
        profit: report.profit,
        winRate: report.winRate
    }, "My profit/loss");
}));

router.get("/my-deposits", authenticate, asyncHandler(async (req, res) => {
    const deposits = await Transaction.findAll({
        where: { userId: req.user.id, type: "DEPOSIT" },
        order: [["createdAt", "DESC"]],
        limit: 50
    });
    return success(res, deposits, "My deposits");
}));

router.get("/my-withdrawals", authenticate, asyncHandler(async (req, res) => {
    const withdrawals = await Transaction.findAll({
        where: { userId: req.user.id, type: "WITHDRAW" },
        order: [["createdAt", "DESC"]],
        limit: 50
    });
    return success(res, withdrawals, "My withdrawals");
}));

router.get("/match/:matchId", authenticate, authorize("REPORT:VIEW"), asyncHandler(async (req, res) => {
    const report = await reportEngine.getMatchReport(req.params.matchId);
    return success(res, report, "Match report");
}));

router.get("/user/:userId", authenticate, authorize("REPORT:VIEW"), asyncHandler(async (req, res) => {
    const allowed = isOwnerRole(req.user.role)
        ? true
        : await isInDownline(req.user.id, req.params.userId, req.user.role);
    if (!allowed) return error(res, "Access denied - user is not in your downline", 403, "SCOPE_VIOLATION");

    const report = await reportEngine.getUserReport(req.params.userId);
    return success(res, report, "User report");
}));

router.get("/audit/:userId", authenticate, authorize("SURVEILLANCE:VIEW"), asyncHandler(async (req, res) => {
    const allowed = isOwnerRole(req.user.role)
        ? true
        : await isInDownline(req.user.id, req.params.userId, req.user.role);
    if (!allowed) return error(res, "Access denied - user is not in your downline", 403, "SCOPE_VIOLATION");

    const trail = await reportEngine.getAuditTrail(req.params.userId);
    return success(res, trail, "Audit trail");
}));

module.exports = router;
