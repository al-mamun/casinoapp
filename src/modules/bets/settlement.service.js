const Bet = require("./bets.model");
const { updateBalance } = require("../wallet/wallet.service");

/**
 * Settle all bets for a match.
 * WON bets: credit potentialWin to the player's wallet.
 * LOST bets: mark as LOST (stake was already deducted when the bet was placed).
 *
 * @param {number} matchId
 * @param {number} winningOdds  - bets whose odds match this value are winners
 */
exports.settleMatch = async (matchId, winningOdds) => {
    const bets = await Bet.findAll({
        where: { matchId, status: { $in: ['PENDING', 'OPEN'] } },
    });

    const errors = [];

    for (const bet of bets) {
        try {
            if (Number(bet.odds) === Number(winningOdds)) {
                // Credit winnings — potentialWin must be a proper number
                const payout = Number(bet.potentialWin || 0);
                if (payout > 0) {
                    await updateBalance(bet.userId, payout, 'BET_WON', {
                        description: `Bet #${bet.id} won on match #${matchId}`,
                        referenceId: String(bet.id),
                        referenceType: 'BET',
                    });
                }
                bet.status = 'WON';
            } else {
                bet.status = 'LOST';
            }

            bet.settledAt = new Date();
            await bet.save();
        } catch (err) {
            // Record per-bet failure; continue settling remaining bets
            errors.push({ betId: bet.id, error: err.message });
            console.error(`[settlement] Failed to settle bet #${bet.id}:`, err.message);
        }
    }

    return {
        total: bets.length,
        settled: bets.length - errors.length,
        errors,
    };
};
