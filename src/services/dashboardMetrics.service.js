const os = require("os");
const { Op, fn, col } = require("sequelize");
const {
    User,
    Wallet,
    Bet,
    DepositRequest,
    WithdrawRequest,
    Transaction,
    Match,
    Session
} = require("../models");

const PLAYER_ROLES = ["PLAYER"];
const AFFILIATE_ROLES = ["SENIOR_AFFILIATE", "AFFILIATE"];
const AGENT_ROLES = ["SUPER_AGENT", "MASTER_AGENT", "AGENT"];

async function getDashboardMetrics() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const onlineWindow = new Date(Date.now() - 15 * 60 * 1000);
    const [
        totalUsers,
        onlineUsersFromSessions,
        onlineUsersFromLogin,
        todaysUsers,
        activePlayers,
        totalDepositRaw,
        totalWithdrawRaw,
        totalBets,
        liveBets,
        sportsBets,
        casinoBets,
        pendingDeposits,
        pendingWithdraws,
        riskExposureRaw
    ] = await Promise.all([
        User.count({ where: { isDeleted: false } }),
        Session.count({ where: { isActive: true } }),
        User.count({ where: { isDeleted: false, lastLoginAt: { [Op.gte]: onlineWindow } } }),
        User.count({ where: { isDeleted: false, createdAt: { [Op.gte]: start } } }),
        User.count({ where: { isDeleted: false, role: { [Op.in]: PLAYER_ROLES }, isActive: true } }),
        Transaction.sum("amount", { where: { type: "DEPOSIT", status: "COMPLETED" } }),
        Transaction.sum("amount", { where: { type: "WITHDRAW", status: "COMPLETED" } }),
        Bet.count(),
        Bet.count({ where: { status: { [Op.in]: ["PENDING", "OPEN"] } } }),
        Bet.count({ include: [{ model: Match, required: false, where: { sportType: "SPORTS" } }] }),
        Bet.count({ include: [{ model: Match, required: false, where: { sportType: "CASINO" } }] }),
        DepositRequest.count({ where: { status: "PENDING" } }),
        WithdrawRequest.count({ where: { status: "PENDING" } }),
        Bet.sum("liability", { where: { status: { [Op.in]: ["PENDING", "OPEN"] } } })
    ]);

    const totalDeposit = Number(totalDepositRaw || 0);
    const totalWithdraw = Number(totalWithdrawRaw || 0);
    const riskExposure = Number(riskExposureRaw || 0);
    const onlineUsers = Math.max(Number(onlineUsersFromSessions || 0), Number(onlineUsersFromLogin || 0));

    return {
        totalUsers,
        onlineUsers,
        todaysUsers,
        activePlayers,
        totalDeposit,
        totalWithdraw,
        companyProfit: totalDeposit - totalWithdraw,
        totalBets,
        liveBets,
        sportsBets,
        casinoBets,
        agentCommission: 0,
        affiliateCommission: 0,
        pendingDeposits,
        pendingWithdraws,
        riskExposure,
        loginActivity: onlineUsers,
        deviceActivity: onlineUsers
    };
}

async function getRealtimeSnapshot() {
    const [metrics, liveVisitors, activeGames, newRegistrations, depositRequests, withdrawalRequests] = await Promise.all([
        getDashboardMetrics(),
        User.count({ where: { createdAt: { [Op.gte]: new Date(Date.now() - 15 * 60 * 1000) } } }),
        Match.count({ where: { status: { [Op.in]: ["LIVE", "ACTIVE"] } } }),
        User.count({ where: { createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
        DepositRequest.count({ where: { status: "PENDING" } }),
        WithdrawRequest.count({ where: { status: "PENDING" } })
    ]);

    return {
        currentlyOnlineUsers: metrics.onlineUsers,
        liveVisitors,
        loggedInUsers: metrics.onlineUsers,
        activeGames,
        liveBets: metrics.liveBets,
        newRegistrations,
        depositRequests,
        withdrawalRequests,
        metrics
    };
}

async function getRoleSegmentCounts() {
    const [affiliates, agents, players] = await Promise.all([
        User.count({ where: { role: { [Op.in]: AFFILIATE_ROLES }, isDeleted: false } }),
        User.count({ where: { role: { [Op.in]: AGENT_ROLES }, isDeleted: false } }),
        User.count({ where: { role: { [Op.in]: PLAYER_ROLES }, isDeleted: false } })
    ]);

    return { affiliates, agents, players };
}

function getSystemMonitoring() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMemPct = totalMem > 0 ? ((totalMem - freeMem) / totalMem) * 100 : 0;
    const cpuLoad = os.loadavg()[0] || 0;
    return {
        cpuUsage: Number(cpuLoad.toFixed(2)),
        ramUsage: Number(usedMemPct.toFixed(2)),
        databaseStatus: "connected",
        apiStatus: "healthy",
        socketStatus: "active"
    };
}

module.exports = {
    getDashboardMetrics,
    getRealtimeSnapshot,
    getRoleSegmentCounts,
    getSystemMonitoring
};
