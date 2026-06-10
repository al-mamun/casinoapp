const router = require("express").Router();
const { Op } = require("sequelize");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { getVisibleMenus } = require("../../utils/rolePermissions");
const {
    User,
    Role,
    Wallet,
    DepositRequest,
    WithdrawRequest,
    Bet,
    Match,
    SystemSettings,
    AuditLog
} = require("../../models");
const {
    getDashboardMetrics,
    getRealtimeSnapshot,
    getRoleSegmentCounts,
    getSystemMonitoring
} = require("../../services/dashboardMetrics.service");

function parseListQuery(req) {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const ALLOWED_SORT_FIELDS = ["id", "createdAt", "updatedAt", "username", "fullName", "email", "balance", "status", "amount", "type"];
    const rawSortBy = String(req.query.sortBy || "createdAt");
    const sortBy = ALLOWED_SORT_FIELDS.includes(rawSortBy) ? rawSortBy : "createdAt";
    const sortOrder = String(req.query.sortOrder || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
    const search = String(req.query.search || "").trim();
    return { page, limit, offset: (page - 1) * limit, sortBy, sortOrder, search };
}

async function sendTable(res, model, options = {}) {
    const { page, limit, offset, sortBy, sortOrder, search } = parseListQuery(res.req);
    const where = options.where ? { ...options.where } : {};
    if (search && options.searchFields?.length) {
        where[Op.or] = options.searchFields.map((field) => ({ [field]: { [Op.like]: `%${search}%` } }));
    }
    const { count, rows } = await model.findAndCountAll({
        where,
        include: options.include || [],
        offset,
        limit,
        order: [[sortBy, sortOrder]]
    });
    return res.json({
        success: true,
        data: rows,
        meta: {
            page,
            limit,
            total: count,
            totalPages: Math.ceil(count / limit),
            sortBy,
            sortOrder,
            search,
            export: {
                csv: `${res.req.baseUrl}${res.req.path}/export?format=csv`,
                excel: `${res.req.baseUrl}${res.req.path}/export?format=excel`
            }
        }
    });
}

router.use(authenticate);
router.use(authorize("REPORT:VIEW"));

router.get("/dashboard", async (req, res) => {
    const [widgets, realtime, roleSegments] = await Promise.all([
        getDashboardMetrics(),
        getRealtimeSnapshot(),
        getRoleSegmentCounts()
    ]);
    res.json({
        success: true,
        data: {
            role: req.user.role,
            widgets,
            realtime,
            roleSegments,
            sidebarLive: {
                onlineUsers: widgets.onlineUsers,
                liveVisitors: realtime.liveVisitors,
                pendingDeposits: widgets.pendingDeposits,
                pendingWithdrawals: widgets.pendingWithdraws,
                activePlayers: widgets.activePlayers,
                activeGames: realtime.activeGames
            },
            systemMonitoring: getSystemMonitoring(),
            menus: getVisibleMenus(req.user.role)
        }
    });
});

router.get("/users", async (req, res) => sendTable(res, User, {
    where: { isDeleted: false },
    searchFields: ["username", "fullName", "email", "phone"],
    include: [{ model: Wallet, as: "wallet", required: false }]
}));

router.get("/roles", async (req, res) => sendTable(res, Role, { searchFields: ["name"] }));
router.get("/deposits", async (req, res) => sendTable(res, DepositRequest, { searchFields: ["methodName", "transactionId", "accountNumber"] }));
router.get("/withdraws", async (req, res) => sendTable(res, WithdrawRequest, { searchFields: ["methodName", "accountNumber"] }));
router.get("/bets", async (req, res) => sendTable(res, Bet, { searchFields: ["selection", "status"] }));
router.get("/games", async (req, res) => sendTable(res, Match, { searchFields: ["homeTeam", "awayTeam", "leagueName", "sportType"] }));

router.get("/reports", async (req, res) => {
    const [dashboard, monitoring] = await Promise.all([getDashboardMetrics(), Promise.resolve(getSystemMonitoring())]);
    res.json({ success: true, data: { dashboard, monitoring } });
});

router.get("/settings", async (req, res) => sendTable(res, SystemSettings, { searchFields: ["key", "category"] }));
router.get("/affiliates", async (req, res) => sendTable(res, User, { where: { role: { [Op.in]: ["SENIOR_AFFILIATE", "AFFILIATE"] }, isDeleted: false }, searchFields: ["username", "fullName"] }));
router.get("/agents", async (req, res) => sendTable(res, User, { where: { role: { [Op.in]: ["SUPER_AGENT", "MASTER_AGENT", "AGENT"] }, isDeleted: false }, searchFields: ["username", "fullName"] }));
router.get("/audit-logs", async (req, res) => sendTable(res, AuditLog, { searchFields: ["action", "entity", "ipAddress", "userAgent"] }));

module.exports = router;
