const { Op, fn, col } = require("sequelize");
const Bet = require("../modules/bets/bets.model");
const Transaction = require("../modules/transaction/transaction.model");
const AuditLog = require("./audit.engine");

// Generate detailed match report
exports.getMatchReport = async (matchId) => {
    const bets = await Bet.findAll({ where: { matchId } });

    let totalStake = 0, totalPayout = 0, totalBets = bets.length;
    let wonCount = 0, lostCount = 0, pendingCount = 0;

    for (const bet of bets) {
        totalStake += Number(bet.stake) || 0;
        if (bet.status === 'WON') {
            totalPayout += Number(bet.potentialWin) || (Number(bet.stake) * Number(bet.odds));
            wonCount++;
        } else if (bet.status === 'LOST') {
            lostCount++;
        } else {
            pendingCount++;
        }
    }

    const profit = totalStake - totalPayout;
    const roi = totalStake > 0 ? ((profit / totalStake) * 100).toFixed(2) : 0;

    return { matchId, totalBets, totalStake, totalPayout, profit, roi, wonCount, lostCount, pendingCount };
};

// Generate user betting report
exports.getUserReport = async (userId) => {
    const totalStake = await Bet.sum("stake", { where: { userId } });
    const totalPayout = await Bet.sum("potentialWin", { where: { userId, status: 'WON' } });
    const totalBets = await Bet.count({ where: { userId } });
    const wonBets = await Bet.count({ where: { userId, status: 'WON' } });
    const lostBets = await Bet.count({ where: { userId, status: 'LOST' } });

    const totalDeposits = await Transaction.sum('amount', { where: { userId, type: 'DEPOSIT' } });
    const totalWithdrawals = await Transaction.sum('amount', { where: { userId, type: 'WITHDRAW' } });
    const totalCommissions = await Transaction.sum('amount', { where: { userId, type: 'COMMISSION' } });

    const profit = (Number(totalStake) || 0) - (Number(totalPayout) || 0);
    const winRate = totalBets > 0 ? ((wonBets / totalBets) * 100).toFixed(2) : 0;

    return {
        totalBets, wonBets, lostBets, winRate,
        totalStake: Number(totalStake) || 0,
        totalPayout: Number(totalPayout) || 0,
        profit,
        totalDeposits: Number(totalDeposits) || 0,
        totalWithdrawals: Number(totalWithdrawals) || 0,
        totalCommissions: Number(totalCommissions) || 0
    };
};

// My report (for current user)
exports.getMyReport = async (userId) => {
    return await exports.getUserReport(userId);
};

// Get turnover report for a date range
exports.getTurnoverReport = async (userId, startDate, endDate) => {
    const where = { userId };
    if (startDate && endDate) {
        where.createdAt = { [Op.between]: [startDate, endDate] };
    }

    const totalStake = await Bet.sum("stake", { where });
    const betCount = await Bet.count({ where });

    return { totalStake: Number(totalStake) || 0, betCount };
};

// Get audit trail for a user
exports.getAuditTrail = async (userId, limit = 50) => {
    return await AuditLog.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit
    });
};

// Detect suspicious activity
exports.detectSuspiciousActivity = async (userId) => {
    const { Op } = require("sequelize");
    const oneHourAgo = new Date(Date.now() - 3600000);

    const rapidBets = await Bet.count({
        where: { userId, createdAt: { [Op.gte]: oneHourAgo } }
    });

    const highStakeBets = await Bet.count({
        where: { userId, stake: { [Op.gte]: 10000 } }
    });

    const totalStake = await Bet.sum("stake", { where: { userId } });

    return {
        isRapidBetting: rapidBets > 20,
        isHighStake: highStakeBets > 5,
        isHighVolume: Number(totalStake) > 500000,
        rapidBetsLastHour: rapidBets,
        highStakeBetsTotal: highStakeBets,
        totalStake: Number(totalStake) || 0,
        isSuspicious: rapidBets > 20 || highStakeBets > 5 || Number(totalStake) > 500000
    };
};
