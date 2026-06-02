const router = require("express").Router();
const { Op } = require("sequelize");
const { authenticate } = require("../../middleware/auth.middleware");
const { User, Wallet, Bet, Transaction, Bonus, Notification, Match } = require("../../models");

router.use(authenticate);

router.get("/profile", async (req, res) => {
    const user = await User.findByPk(req.user.id, { attributes: { exclude: ["password"] } });
    return res.json({ success: true, data: user });
});

router.get("/wallet", async (req, res) => {
    const wallet = await Wallet.findOne({ where: { userId: req.user.id } });
    return res.json({ success: true, data: wallet });
});

router.get("/bets", async (req, res) => {
    const rows = await Bet.findAll({ where: { userId: req.user.id }, order: [["createdAt", "DESC"]], limit: 100 });
    return res.json({ success: true, data: rows });
});

router.get("/transactions", async (req, res) => {
    const rows = await Transaction.findAll({ where: { userId: req.user.id }, order: [["createdAt", "DESC"]], limit: 100 });
    return res.json({ success: true, data: rows });
});

router.get("/bonuses", async (req, res) => {
    const rows = await Bonus.findAll({ where: { [Op.or]: [{ userId: req.user.id }, { userId: null }] }, order: [["createdAt", "DESC"]] });
    return res.json({ success: true, data: rows });
});

router.get("/games", async (_req, res) => {
    const rows = await Match.findAll({ where: { isActive: true }, order: [["createdAt", "DESC"]], limit: 100 });
    return res.json({ success: true, data: rows });
});

router.get("/notifications", async (req, res) => {
    const rows = await Notification.findAll({ where: { userId: req.user.id }, order: [["createdAt", "DESC"]], limit: 100 });
    return res.json({ success: true, data: rows });
});

router.get("/bonus-wallet", async (req, res) => {
    const wallet = await Wallet.findOne({ where: { userId: req.user.id } });
    if (!wallet) return res.status(404).json({ success: false, message: "Wallet not found" });
    return res.json({
        success: true,
        data: {
            bonus: Number(wallet.bonusEarned || 0)
        }
    });
});

router.get("/turnover", async (req, res) => {
    const wallet = await Wallet.findOne({ where: { userId: req.user.id } });
    if (!wallet) return res.status(404).json({ success: false, message: "Wallet not found" });
    const completedFromBetsRaw = await Transaction.sum("amount", {
        where: { userId: req.user.id, type: "BET_PLACED", status: "COMPLETED" }
    });
    const completedFromBets = Number(Number(completedFromBetsRaw || 0).toFixed(2));
    wallet.completedTurnover = completedFromBets;
    await wallet.save();

    const requiredTurnover = Number(wallet.requiredTurnover || 0);
    const completedTurnover = Number(completedFromBets || 0);
    const remainingTurnover = Math.max(0, requiredTurnover - completedTurnover);
    const progressPercent = requiredTurnover > 0
        ? Math.min(100, Number(((completedTurnover / requiredTurnover) * 100).toFixed(2)))
        : 100;
    return res.json({
        success: true,
        data: {
            requiredTurnover,
            completedTurnover,
            remainingTurnover,
            progressPercent
        }
    });
});

router.post("/deposit", async (req, res) => {
    try {
        const amount = Number(req.body?.amount || 0);
        const methodName = String(req.body?.methodName || "").trim();
        const transactionId = String(req.body?.transactionId || "").trim();
        const accountNumber = String(req.body?.accountNumber || "").trim();

        if (!Number.isFinite(amount) || amount < 100) {
            return res.status(400).json({ success: false, message: "Minimum deposit is 100" });
        }
        if (!methodName || !transactionId || !accountNumber) {
            return res.status(400).json({ success: false, message: "Method, account number and transaction ID are required" });
        }

        const wallet = await Wallet.findOne({ where: { userId: req.user.id } });
        if (!wallet) return res.status(404).json({ success: false, message: "Wallet not found" });

        const balanceBefore = Number(wallet.balance || 0);
        const isFirstDeposit = !wallet.firstDepositBonusApplied && Number(wallet.totalDeposit || 0) <= 0;
        const bonus = isFirstDeposit ? 10 : Number((amount * 0.03).toFixed(2));
        const creditedAmount = Number((amount + bonus).toFixed(2));
        const balanceAfter = Number((balanceBefore + creditedAmount).toFixed(2));

        wallet.balance = balanceAfter;
        wallet.totalDeposit = Number((Number(wallet.totalDeposit || 0) + amount).toFixed(2));
        wallet.bonusEarned = Number((Number(wallet.bonusEarned || 0) + bonus).toFixed(2));
        wallet.requiredTurnover = Number((Number(wallet.requiredTurnover || 0) + (amount * 2)).toFixed(2));
        if (isFirstDeposit) wallet.firstDepositBonusApplied = true;
        await wallet.save();

        await Transaction.create({
            userId: req.user.id,
            type: "DEPOSIT",
            amount,
            balanceBefore,
            balanceAfter,
            status: "COMPLETED",
            description: `Deposit via ${methodName}. Bonus: ${bonus}. Trx: ${transactionId}`,
            referenceId: transactionId,
            referenceType: "USER_DEPOSIT"
        });

        return res.json({
            success: true,
            message: "Deposit successful",
            data: {
                amount,
                bonus,
                creditedAmount,
                balance: balanceAfter,
                totalDeposit: Number(wallet.totalDeposit || 0),
                bonusEarned: Number(wallet.bonusEarned || 0),
                requiredTurnover: Number(wallet.requiredTurnover || 0),
                completedTurnover: Number(wallet.completedTurnover || 0),
                remainingTurnover: Math.max(0, Number(wallet.requiredTurnover || 0) - Number(wallet.completedTurnover || 0))
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || "Deposit failed" });
    }
});

router.post("/withdraw", async (req, res) => {
    try {
        const amount = Number(req.body?.amount || 0);
        const methodName = String(req.body?.methodName || "").trim();
        const accountNumber = String(req.body?.accountNumber || "").trim();

        if (!Number.isFinite(amount) || amount < 100) {
            return res.status(400).json({ success: false, message: "Minimum withdraw is 100" });
        }
        if (!methodName || !accountNumber) {
            return res.status(400).json({ success: false, message: "Method and account number are required" });
        }

        const wallet = await Wallet.findOne({ where: { userId: req.user.id } });
        if (!wallet) return res.status(404).json({ success: false, message: "Wallet not found" });

        const requiredTurnover = Number(wallet.requiredTurnover || 0);
        const completedTurnover = Number(wallet.completedTurnover || 0);
        if (completedTurnover < requiredTurnover) {
            return res.status(400).json({
                success: false,
                message: "Withdraw unavailable. Complete your required turnover first."
            });
        }

        const balanceBefore = Number(wallet.balance || 0);
        if (balanceBefore < amount) {
            return res.status(400).json({ success: false, message: "Insufficient balance" });
        }
        const balanceAfter = Number((balanceBefore - amount).toFixed(2));
        wallet.balance = balanceAfter;
        wallet.totalWithdraw = Number((Number(wallet.totalWithdraw || 0) + amount).toFixed(2));
        await wallet.save();

        await Transaction.create({
            userId: req.user.id,
            type: "WITHDRAW",
            amount,
            balanceBefore,
            balanceAfter,
            status: "COMPLETED",
            description: `Withdraw via ${methodName} to ${accountNumber}`,
            referenceType: "USER_WITHDRAW"
        });

        return res.json({
            success: true,
            message: "Withdrawal successful",
            data: {
                amount,
                balance: balanceAfter,
                totalWithdraw: Number(wallet.totalWithdraw || 0)
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message || "Withdraw failed" });
    }
});

module.exports = router;
