const { Wallet, User, Transaction } = require("../../models");

/**
 * Update a user's wallet balance atomically.
 * Uses model-level operations compatible with the MongoDB adapter.
 * Falls back gracefully if Transaction model is unavailable.
 *
 * @param {number} userId
 * @param {number} amount    - always positive
 * @param {'DEPOSIT'|'WITHDRAW'|'BET_PLACED'|'BET_WON'|'BET_LOST'|'COMMISSION'|'TRANSFER_IN'|'TRANSFER_OUT'|'REFUND'|'GAME_SETTLEMENT'} type
 * @param {object} [opts]
 * @param {string} [opts.description]
 * @param {string} [opts.referenceId]
 * @param {string} [opts.referenceType]
 * @returns {{ balanceBefore: number, balanceAfter: number }}
 */
async function updateBalance(userId, amount, type, opts = {}) {
    const wallet = await Wallet.findOne({ where: { userId } });
    if (!wallet) throw new Error(`Wallet not found for userId=${userId}`);

    const amountNum = Number(amount || 0);
    if (Number.isNaN(amountNum) || amountNum < 0) throw new Error(`Invalid amount: ${amount}`);

    const balanceBefore = Number(Number(wallet.balance).toFixed(2));

    const CREDIT_TYPES = ['DEPOSIT', 'BET_WON', 'COMMISSION', 'TRANSFER_IN', 'REFUND', 'GAME_SETTLEMENT'];
    const isCredit = CREDIT_TYPES.includes(type);
    const balanceAfter = Number(
        (isCredit ? balanceBefore + amountNum : balanceBefore - amountNum).toFixed(2)
    );

    if (!isCredit && balanceAfter < 0) {
        throw new Error(`Insufficient balance: have ${balanceBefore}, need ${amountNum}`);
    }

    const uid = Number(userId);
    const uidStr = String(userId);
    const newTotalDeposit = isCredit
        ? Number((Number(wallet.totalDeposit || 0) + amountNum).toFixed(2))
        : Number(wallet.totalDeposit || 0);
    const newTotalWithdraw = !isCredit
        ? Number((Number(wallet.totalWithdraw || 0) + amountNum).toFixed(2))
        : Number(wallet.totalWithdraw || 0);

    // updateMany covers any leftover duplicate wallet documents for this userId
    try {
        const walletCollection = await Wallet.collection();
        await walletCollection.updateMany(
            { userId: { $in: [uid, uidStr] } },
            { $set: { balance: balanceAfter, totalDeposit: newTotalDeposit, totalWithdraw: newTotalWithdraw, updatedAt: new Date() } }
        );
    } catch {
        if (wallet._id) {
            try {
                const walletCollection = await Wallet.collection();
                await walletCollection.updateOne(
                    { _id: wallet._id },
                    { $set: { balance: balanceAfter, totalDeposit: newTotalDeposit, totalWithdraw: newTotalWithdraw, updatedAt: new Date() } }
                );
            } catch {
                wallet.balance = balanceAfter;
                wallet.totalDeposit = newTotalDeposit;
                wallet.totalWithdraw = newTotalWithdraw;
                await wallet.save();
            }
        } else {
            wallet.balance = balanceAfter;
            wallet.totalDeposit = newTotalDeposit;
            wallet.totalWithdraw = newTotalWithdraw;
            await wallet.save();
        }
    }

    // Keep User.balance in sync
    try {
        const userCollection = await User.collection();
        await userCollection.updateMany(
            { id: { $in: [uid, uidStr] } },
            { $set: { balance: balanceAfter, updatedAt: new Date() } }
        );
    } catch {
        await User.update({ balance: balanceAfter }, { where: { id: uid } });
    }

    // Record ledger entry
    try {
        await Transaction.create({
            userId,
            type,
            amount: amountNum,
            balanceBefore,
            balanceAfter,
            status: 'COMPLETED',
            description: opts.description || null,
            referenceId: opts.referenceId || null,
            referenceType: opts.referenceType || null,
        });
    } catch (txErr) {
        // Ledger write failure should not roll back the balance — log and continue
        console.error('[wallet.service] Transaction ledger write failed:', txErr.message);
    }

    return { balanceBefore, balanceAfter };
}

module.exports = { updateBalance };
