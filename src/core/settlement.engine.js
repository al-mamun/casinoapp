const sequelize = require("../config/sequelize.db");
const Bet = require("../modules/bets/bets.model");
const Wallet = require("../modules/wallet/wallet.model");
const Transaction = require("../modules/transaction/transaction.model");
const AuditLog = require("./audit.engine");
const commissionEngine = require("./commission.engine");

// Settle all bets for a match with a winning selection
exports.settleMatch = async (matchId, winningSelection, settledByUserId) => {
    const t = await sequelize.transaction();

    try {
        const bets = await Bet.findAll({
            where: { matchId, status: { [require("sequelize").Op.in]: ['PENDING', 'OPEN'] } },
            transaction: t
        });

        let totalSettled = 0;
        let totalWon = 0;
        let totalLost = 0;

        for (const bet of bets) {
            const wallet = await Wallet.findOne({
                where: { userId: bet.userId },
                transaction: t
            });

            if (!wallet) continue;

            const balanceBefore = Number(wallet.balance);

            if (bet.selection === winningSelection) {
                // Winner
                bet.status = "WON";
                const payout = Number(bet.potentialWin) || (Number(bet.stake) * Number(bet.odds));
                wallet.balance = Number(wallet.balance) + payout;

                await Transaction.create({
                    userId: bet.userId,
                    type: 'BET_WON',
                    amount: payout,
                    balanceBefore,
                    balanceAfter: Number(wallet.balance),
                    description: `Won bet #${bet.id} on match #${matchId}`,
                    referenceId: String(bet.id),
                    referenceType: 'BET'
                }, { transaction: t });

                // Distribute commission on winnings
                await commissionEngine.distributeCommission(
                    bet.userId,
                    payout - Number(bet.stake),
                    t
                );

                totalWon++;
            } else {
                // Loser
                bet.status = "LOST";

                await Transaction.create({
                    userId: bet.userId,
                    type: 'BET_LOST',
                    amount: Number(bet.stake),
                    balanceBefore,
                    balanceAfter: Number(wallet.balance),
                    description: `Lost bet #${bet.id} on match #${matchId}`,
                    referenceId: String(bet.id),
                    referenceType: 'BET'
                }, { transaction: t });

                // Distribute commission on losses
                await commissionEngine.distributeCommission(
                    bet.userId,
                    Number(bet.stake),
                    t
                );

                totalLost++;
            }

            bet.settledAt = new Date();
            bet.settledBy = settledByUserId;

            await bet.save({ transaction: t });
            await wallet.save({ transaction: t });
            totalSettled++;
        }

        await AuditLog.create({
            userId: settledByUserId,
            action: "MATCH_SETTLED",
            entity: "Match",
            entityId: matchId,
            description: `Settled ${totalSettled} bets (${totalWon} won, ${totalLost} lost) for match #${matchId}`
        }, { transaction: t });

        await t.commit();

        return { totalSettled, totalWon, totalLost };
    } catch (err) {
        await t.rollback();
        throw err;
    }
};

// Settle a single bet manually
exports.settleBet = async (betId, result, settledByUserId) => {
    const t = await sequelize.transaction();

    try {
        const bet = await Bet.findByPk(betId, { lock: true, transaction: t });
        if (!bet) throw new Error("Bet not found");
        if (!['PENDING', 'OPEN'].includes(bet.status)) throw new Error("Bet already settled");

        const wallet = await Wallet.findOne({
            where: { userId: bet.userId },
            lock: true,
            transaction: t
        });

        const balanceBefore = Number(wallet.balance);

        if (result === "WIN") {
            bet.status = "WON";
            const payout = Number(bet.potentialWin) || (Number(bet.stake) * Number(bet.odds));
            wallet.balance = Number(wallet.balance) + payout;

            await Transaction.create({
                userId: bet.userId, type: 'BET_WON', amount: payout,
                balanceBefore, balanceAfter: Number(wallet.balance),
                referenceId: String(bet.id), referenceType: 'BET'
            }, { transaction: t });
        } else if (result === "LOSS") {
            bet.status = "LOST";
            await Transaction.create({
                userId: bet.userId, type: 'BET_LOST', amount: Number(bet.stake),
                balanceBefore, balanceAfter: Number(wallet.balance),
                referenceId: String(bet.id), referenceType: 'BET'
            }, { transaction: t });
        } else if (result === "CANCEL") {
            bet.status = "CANCELLED";
            wallet.balance = Number(wallet.balance) + Number(bet.stake); // Refund
            await Transaction.create({
                userId: bet.userId, type: 'REFUND', amount: Number(bet.stake),
                balanceBefore, balanceAfter: Number(wallet.balance),
                referenceId: String(bet.id), referenceType: 'BET'
            }, { transaction: t });
        }

        bet.settledAt = new Date();
        bet.settledBy = settledByUserId;

        await bet.save({ transaction: t });
        await wallet.save({ transaction: t });
        await t.commit();
        return bet;
    } catch (err) {
        await t.rollback();
        throw err;
    }
};

// Get pending bets for a match
exports.getMatchPendingBets = async (matchId) => {
    return await Bet.findAll({
        where: { matchId, status: { [require("sequelize").Op.in]: ['PENDING', 'OPEN'] } },
        order: [['createdAt', 'DESC']]
    });
};
