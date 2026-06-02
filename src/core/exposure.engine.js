const { Op, fn, col, literal } = require("sequelize");
const Bet = require("../modules/bets/bets.model");
const User = require("../modules/user/user.model");

const OPEN_STATUSES = ['PENDING', 'OPEN'];

// Calculate exposure for a specific match by selection
exports.calculateMatchExposure = async (matchId) => {
    const bets = await Bet.findAll({
        where: { matchId, status: { [Op.in]: OPEN_STATUSES } },
        attributes: [
            'selection',
            [fn('SUM', col('stake')), 'totalStake'],
            [fn('SUM', col('liability')), 'totalLiability'],
            [fn('SUM', col('potentialWin')), 'totalPotentialWin'],
            [fn('COUNT', col('id')), 'betCount']
        ],
        group: ['selection']
    });

    return bets.map(b => b.toJSON());
};

// Get total exposure for a user
exports.getUserExposure = async (userId) => {
    const exposure = await Bet.sum("liability", {
        where: { userId, status: { [Op.in]: OPEN_STATUSES } }
    });
    return Number(exposure) || 0;
};

// Get user exposure broken down by match
exports.getUserMatchExposures = async (userId) => {
    const bets = await Bet.findAll({
        where: { userId, status: { [Op.in]: OPEN_STATUSES } },
        attributes: [
            'matchId',
            [fn('SUM', col('stake')), 'totalStake'],
            [fn('SUM', col('liability')), 'totalLiability'],
            [fn('COUNT', col('id')), 'betCount']
        ],
        group: ['matchId']
    });

    return bets.map(b => b.toJSON());
};

// Get combined exposure for all downline users
exports.getDownlineExposure = async (parentId) => {
    const downlineUsers = await User.findAll({
        where: { parentId },
        attributes: ['id']
    });

    const userIds = downlineUsers.map(u => u.id);
    if (userIds.length === 0) return { totalExposure: 0, userCount: 0 };

    const exposure = await Bet.sum("liability", {
        where: { userId: { [Op.in]: userIds }, status: { [Op.in]: OPEN_STATUSES } }
    });

    return { totalExposure: Number(exposure) || 0, userCount: userIds.length };
};

// Get exposure for all active matches
exports.getAllMatchExposures = async () => {
    const bets = await Bet.findAll({
        where: { status: { [Op.in]: OPEN_STATUSES } },
        attributes: [
            'matchId',
            [fn('SUM', col('stake')), 'totalStake'],
            [fn('SUM', col('liability')), 'totalLiability'],
            [fn('COUNT', col('id')), 'betCount']
        ],
        group: ['matchId'],
        order: [[literal('totalLiability'), 'DESC']]
    });

    return bets.map(b => b.toJSON());
};
