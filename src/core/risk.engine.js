const { Op } = require("sequelize");
const Bet = require("../modules/bets/bets.model");
const Match = require("../modules/matches/matches.model");

const MAX_STAKE = 50000;
const MAX_LIABILITY = 100000;
const RAPID_BET_WINDOW = 60; // seconds
const RAPID_BET_LIMIT = 5;

// Validate if a bet can be placed (risk check)
exports.validateBetRisk = async (userId, matchId, stake, odds) => {
    if (stake > MAX_STAKE) {
        return { allowed: false, reason: `Stake exceeds max limit of ${MAX_STAKE}` };
    }

    const liability = (odds - 1) * stake;
    const userExposure = await exports.getUserExposure(userId);

    if (userExposure + liability > MAX_LIABILITY) {
        return { allowed: false, reason: `Total liability would exceed ${MAX_LIABILITY}` };
    }

    // Rapid bet detection
    const recentBets = await Bet.count({
        where: {
            userId,
            createdAt: { [Op.gte]: new Date(Date.now() - RAPID_BET_WINDOW * 1000) }
        }
    });

    if (recentBets >= RAPID_BET_LIMIT) {
        return { allowed: false, reason: 'Rapid betting detected. Please wait.' };
    }

    return { allowed: true };
};

// Get overall risk data
exports.getRiskData = async () => {
    const activeBets = await Bet.count({ where: { status: { [Op.in]: ['PENDING', 'OPEN'] } } });
    const totalStake = await Bet.sum("stake", { where: { status: { [Op.in]: ['PENDING', 'OPEN'] } } });
    const totalLiability = await Bet.sum("liability", { where: { status: { [Op.in]: ['PENDING', 'OPEN'] } } });

    return {
        activeBets: activeBets || 0,
        totalStake: Number(totalStake) || 0,
        totalLiability: Number(totalLiability) || 0,
        maxStakeLimit: MAX_STAKE,
        maxLiabilityLimit: MAX_LIABILITY
    };
};

// Get user-level exposure
exports.getUserExposure = async (userId) => {
    const exposure = await Bet.sum("liability", {
        where: { userId, status: { [Op.in]: ['PENDING', 'OPEN'] } }
    });
    return Number(exposure) || 0;
};

// Get match-level exposure
exports.getMatchExposure = async (matchId) => {
    const totalStake = await Bet.sum("stake", { where: { matchId, status: { [Op.in]: ['PENDING', 'OPEN'] } } });
    const totalLiability = await Bet.sum("liability", { where: { matchId, status: { [Op.in]: ['PENDING', 'OPEN'] } } });
    const betCount = await Bet.count({ where: { matchId, status: { [Op.in]: ['PENDING', 'OPEN'] } } });

    return {
        matchId,
        totalStake: Number(totalStake) || 0,
        totalLiability: Number(totalLiability) || 0,
        betCount
    };
};

// Get critical (high-risk) matches — over 70% of max liability
exports.getCriticalMatches = async () => {
    const threshold = MAX_LIABILITY * 0.7;
    const matches = await Match.findAll({ where: { status: { [Op.in]: ['ACTIVE', 'LIVE'] } } });

    const critical = [];
    for (const match of matches) {
        const exposure = await exports.getMatchExposure(match.id);
        if (exposure.totalLiability >= threshold) {
            critical.push({ ...match.toJSON(), exposure });
        }
    }
    return critical;
};

// Get top exposed users
exports.getTopExposedUsers = async (limit = 10) => {
    const bets = await Bet.findAll({
        where: { status: { [Op.in]: ['PENDING', 'OPEN'] } },
        attributes: [
            'userId',
            [require("sequelize").fn('SUM', require("sequelize").col('liability')), 'totalLiability'],
            [require("sequelize").fn('SUM', require("sequelize").col('stake')), 'totalStake'],
            [require("sequelize").fn('COUNT', require("sequelize").col('id')), 'betCount']
        ],
        group: ['userId'],
        order: [[require("sequelize").literal('totalLiability'), 'DESC']],
        limit
    });
    return bets;
};
