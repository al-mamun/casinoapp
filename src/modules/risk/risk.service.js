

const Bet = require("../bets/bets.model");

exports.calculateExposure = async (matchId) => {

    const bets = await Bet.findAll({
        where: { matchId, status: "PENDING" }
    });

    let totalStake = 0;
    let totalLiability = 0;

    bets.forEach(b => {
        totalStake += b.stake;
        totalLiability += (b.potentialWin - b.stake);
    });

    return {
        totalStake,
        totalLiability
    };
};