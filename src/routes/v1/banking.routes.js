const router = require("express").Router();
const { Op } = require("sequelize");
const sequelize = require("../../config/sequelize.db");
const { User, Wallet, Transaction, DepositRequest, WithdrawRequest, BankingMethod } = require("../../models");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { validate, depositSchema, transferSchema, bankingMethodSchema, depositRequestSchema, withdrawRequestSchema } = require("../../utils/validation");
const { success, error, paginated } = require("../../utils/apiResponse");
const AuditLog = require("../../core/audit.engine");
const { getFullDownlineIds } = require("../../services/hierarchyService");

// ==================== LEDGER ====================

// GET /api/v1/banking/ledger
router.get("/ledger", authenticate, authorize('BANKING:VIEW'), asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, type, userId } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (type) where.type = type;
    if (userId) where.userId = userId;
    if (req.user.role !== 'OWNER') where.userId = req.user.id;

    const { count, rows } = await Transaction.findAndCountAll({
        where,
        include: [{ model: User, attributes: ['id', 'username', 'role'] }],
        offset: Number(offset),
        limit: Number(limit),
        order: [['createdAt', 'DESC']]
    });

    return paginated(res, rows, count, page, limit);
}));

// GET /api/v1/banking/deposits
router.get("/deposits", authenticate, authorize('BANKING:VIEW'), asyncHandler(async (req, res) => {
    const where = { type: 'DEPOSIT' };
    if (req.user.role !== 'OWNER') where.userId = req.user.id;

    const transactions = await Transaction.findAll({ where, order: [['createdAt', 'DESC']], limit: 100 });
    return success(res, transactions);
}));

// GET /api/v1/banking/withdrawals
router.get("/withdrawals", authenticate, authorize('BANKING:VIEW'), asyncHandler(async (req, res) => {
    const where = { type: 'WITHDRAW' };
    if (req.user.role !== 'OWNER') where.userId = req.user.id;

    const transactions = await Transaction.findAll({ where, order: [['createdAt', 'DESC']], limit: 100 });
    return success(res, transactions);
}));

// ==================== MANUAL DEPOSIT / WITHDRAW ====================

// POST /api/v1/banking/deposit/manual
router.post("/deposit/manual", authenticate, authorize('BANKING:DEPOSIT'), validate(depositSchema), asyncHandler(async (req, res) => {
    const { userId, amount, description } = req.body;

    const t = await sequelize.transaction();
    try {
        const wallet = await Wallet.findOne({ where: { userId }, transaction: t });
        if (!wallet) { await t.rollback(); return error(res, "Wallet not found", 404); }

        const balanceBefore = Number(wallet.balance);
        wallet.balance = Number(wallet.balance) + Number(amount);
        wallet.totalDeposit = Number(wallet.totalDeposit || 0) + Number(amount);
        await wallet.save({ transaction: t });

        await Transaction.create({
            userId, type: 'DEPOSIT', amount,
            balanceBefore, balanceAfter: Number(wallet.balance),
            fromId: req.user.id, description: description || `Manual deposit by ${req.user.username}`,
            status: 'COMPLETED'
        }, { transaction: t });

        await AuditLog.create({
            userId: req.user.id, action: "CHIPS_DEPOSITED",
            entity: "Wallet", entityId: wallet.id, amount,
            description: `Deposited ${amount} to user #${userId}`, ipAddress: req.ip
        }, { transaction: t });

        await t.commit();
        return success(res, { balance: Number(wallet.balance) }, `Deposited ${amount} successfully`);
    } catch (err) {
        await t.rollback();
        throw err;
    }
}));

// POST /api/v1/banking/withdraw/manual
router.post("/withdraw/manual", authenticate, authorize('BANKING:WITHDRAW'), validate(depositSchema), asyncHandler(async (req, res) => {
    const { userId, amount, description } = req.body;

    const t = await sequelize.transaction();
    try {
        const wallet = await Wallet.findOne({ where: { userId }, transaction: t });
        if (!wallet) { await t.rollback(); return error(res, "Wallet not found", 404); }
        if (Number(wallet.balance) < Number(amount)) { await t.rollback(); return error(res, "Insufficient balance", 400, "INSUFFICIENT_BALANCE"); }

        const balanceBefore = Number(wallet.balance);
        wallet.balance = Number(wallet.balance) - Number(amount);
        wallet.totalWithdraw = Number(wallet.totalWithdraw || 0) + Number(amount);
        await wallet.save({ transaction: t });

        await Transaction.create({
            userId, type: 'WITHDRAW', amount,
            balanceBefore, balanceAfter: Number(wallet.balance),
            fromId: req.user.id, description: description || `Manual withdraw by ${req.user.username}`,
            status: 'COMPLETED'
        }, { transaction: t });

        await AuditLog.create({
            userId: req.user.id, action: "CHIPS_WITHDRAWN",
            entity: "Wallet", entityId: wallet.id, amount,
            description: `Withdrew ${amount} from user #${userId}`, ipAddress: req.ip
        }, { transaction: t });

        await t.commit();
        return success(res, { balance: Number(wallet.balance) }, `Withdrew ${amount} successfully`);
    } catch (err) {
        await t.rollback();
        throw err;
    }
}));

// POST /api/v1/banking/transfer (P2P) — with settings enforcement
router.post("/transfer", authenticate, authorize('BANKING:TRANSFER'), validate(transferSchema), asyncHandler(async (req, res) => {
    const { toUserId, amount, description } = req.body;

    if (req.user.id === toUserId) return error(res, "Cannot transfer to yourself", 400);

    // Check P2P settings
    const { SystemSettings } = require("../../models");
    const p2pEnabled = await SystemSettings.findOne({ where: { key: 'p2p_enabled' } });
    if (p2pEnabled && p2pEnabled.value === 'false') {
        return error(res, "P2P transfers are currently disabled", 403, "P2P_DISABLED");
    }

    const p2pMin = await SystemSettings.findOne({ where: { key: 'p2p_min_amount' } });
    const p2pMax = await SystemSettings.findOne({ where: { key: 'p2p_max_amount' } });
    const minAmount = p2pMin ? Number(JSON.parse(p2pMin.value)) : 100;
    const maxAmount = p2pMax ? Number(JSON.parse(p2pMax.value)) : 10000;

    if (amount < minAmount) return error(res, `Minimum transfer amount is ${minAmount}`, 400, "P2P_MIN_LIMIT");
    if (amount > maxAmount) return error(res, `Maximum transfer amount is ${maxAmount}`, 400, "P2P_MAX_LIMIT");

    const t = await sequelize.transaction();
    try {
        const fromWallet = await Wallet.findOne({ where: { userId: req.user.id }, transaction: t });
        const toWallet = await Wallet.findOne({ where: { userId: toUserId }, transaction: t });

        if (!fromWallet || !toWallet) { await t.rollback(); return error(res, "Wallet not found", 404); }
        if (Number(fromWallet.balance) < Number(amount)) { await t.rollback(); return error(res, "Insufficient balance", 400); }

        const fromBefore = Number(fromWallet.balance);
        const toBefore = Number(toWallet.balance);

        fromWallet.balance = Number(fromWallet.balance) - Number(amount);
        toWallet.balance = Number(toWallet.balance) + Number(amount);

        await fromWallet.save({ transaction: t });
        await toWallet.save({ transaction: t });

        await Transaction.create({
            userId: req.user.id, type: 'TRANSFER_OUT', amount,
            balanceBefore: fromBefore, balanceAfter: Number(fromWallet.balance),
            toId: toUserId, description: description || `Transfer to user #${toUserId}`
        }, { transaction: t });

        await Transaction.create({
            userId: toUserId, type: 'TRANSFER_IN', amount,
            balanceBefore: toBefore, balanceAfter: Number(toWallet.balance),
            fromId: req.user.id, description: description || `Transfer from user #${req.user.id}`
        }, { transaction: t });

        await t.commit();
        return success(res, { balance: Number(fromWallet.balance) }, `Transferred ${amount} successfully`);
    } catch (err) {
        await t.rollback();
        throw err;
    }
}));

// ==================== DEPOSIT REQUESTS ====================

// GET /api/v1/banking/deposit-requests
router.get("/deposit-requests", authenticate, authorize('BANKING:APPROVE'), asyncHandler(async (req, res) => {
    const { status = 'PENDING', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { count, rows } = await DepositRequest.findAndCountAll({
        where: { status },
        include: [{ model: User, attributes: ['id', 'username', 'role'] }],
        offset: Number(offset), limit: Number(limit),
        order: [['createdAt', 'DESC']]
    });

    return paginated(res, rows, count, page, limit);
}));

// POST /api/v1/banking/deposit-requests (player creates request)
router.post("/deposit-requests", authenticate, asyncHandler(async (req, res) => {
    const { amount, methodId, methodName, accountNumber, transactionId, proofImage } = req.body;
    if (!Number(amount) || Number(amount) < 100) return error(res, "Minimum deposit amount is 100", 400, "MIN_DEPOSIT");
    if (!accountNumber) return error(res, "Sender account number is required", 400, "ACCOUNT_REQUIRED");
    if (!transactionId) return error(res, "Transaction ID is required", 400, "TRX_REQUIRED");

    const method = methodId ? await BankingMethod.findByPk(methodId) : null;
    const duplicate = await DepositRequest.findOne({ where: { userId: req.user.id, transactionId } });
    if (duplicate) return error(res, "This transaction ID was already submitted", 409, "DUPLICATE_TRX");

    const request = await DepositRequest.create({
        userId: req.user.id,
        amount,
        methodId,
        methodName: method?.name || methodName || null,
        accountNumber,
        transactionId,
        proofImage
    });

    return success(res, request, "Deposit request submitted", 201);
}));

// POST /api/v1/banking/deposit-requests/:id/approve
router.post("/deposit-requests/:id/approve", authenticate, authorize('BANKING:APPROVE'), asyncHandler(async (req, res) => {
    const request = await DepositRequest.findByPk(req.params.id);
    if (!request) return error(res, "Request not found", 404);
    if (request.status !== 'PENDING') return error(res, "Request already processed", 400);

    const t = await sequelize.transaction();
    try {
        request.status = 'APPROVED';
        request.approvedBy = req.user.id;
        request.processedAt = new Date();
        await request.save({ transaction: t });

        const wallet = await Wallet.findOne({ where: { userId: request.userId }, transaction: t });
        const balanceBefore = Number(wallet.balance);
        wallet.balance = Number(wallet.balance) + Number(request.amount);
        wallet.totalDeposit = Number(wallet.totalDeposit || 0) + Number(request.amount);
        await wallet.save({ transaction: t });

        await Transaction.create({
            userId: request.userId, type: 'DEPOSIT', amount: request.amount,
            balanceBefore, balanceAfter: Number(wallet.balance),
            fromId: req.user.id, description: `Deposit request #${request.id} approved`,
            referenceId: String(request.id), referenceType: 'DEPOSIT_REQUEST'
        }, { transaction: t });

        await AuditLog.create({
            userId: req.user.id, action: "DEPOSIT_APPROVED",
            entity: "DepositRequest", entityId: request.id, amount: request.amount, ipAddress: req.ip
        }, { transaction: t });

        await t.commit();
        return success(res, null, "Deposit approved");
    } catch (err) {
        await t.rollback();
        throw err;
    }
}));

// POST /api/v1/banking/deposit-requests/:id/reject
router.post("/deposit-requests/:id/reject", authenticate, authorize('BANKING:APPROVE'), asyncHandler(async (req, res) => {
    const request = await DepositRequest.findByPk(req.params.id);
    if (!request) return error(res, "Request not found", 404);
    if (request.status !== 'PENDING') return error(res, "Request already processed", 400);

    request.status = 'REJECTED';
    request.approvedBy = req.user.id;
    request.rejectedReason = req.body.reason || null;
    request.processedAt = new Date();
    await request.save();

    return success(res, null, "Deposit rejected");
}));

// ==================== WITHDRAW REQUESTS ====================

// GET /api/v1/banking/withdraw-requests
router.get("/withdraw-requests", authenticate, authorize('BANKING:APPROVE'), asyncHandler(async (req, res) => {
    const { status = 'PENDING', page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const { count, rows } = await WithdrawRequest.findAndCountAll({
        where: { status },
        include: [{ model: User, attributes: ['id', 'username', 'role'] }],
        offset: Number(offset), limit: Number(limit),
        order: [['createdAt', 'DESC']]
    });

    return paginated(res, rows, count, page, limit);
}));

// POST /api/v1/banking/withdraw-requests (player creates)
router.post("/withdraw-requests", authenticate, asyncHandler(async (req, res) => {
    const { amount, methodId, methodName, accountNumber } = req.body;
    if (!Number(amount) || Number(amount) < 100) return error(res, "Minimum withdrawal amount is 100", 400, "MIN_WITHDRAW");
    if (!accountNumber) return error(res, "Receiving account number is required", 400, "ACCOUNT_REQUIRED");

    const wallet = await Wallet.findOne({ where: { userId: req.user.id } });
    if (!wallet) return error(res, "Wallet not found", 404);
    if (Number(wallet.balance) < Number(amount)) return error(res, "Insufficient balance", 400);

    const method = methodId ? await BankingMethod.findByPk(methodId) : null;

    const request = await WithdrawRequest.create({
        userId: req.user.id, amount, methodId,
        methodName: method?.name || methodName || null, accountNumber
    });

    return success(res, request, "Withdraw request submitted", 201);
}));

// POST /api/v1/banking/withdraw-requests/:id/approve
router.post("/withdraw-requests/:id/approve", authenticate, authorize('BANKING:APPROVE'), asyncHandler(async (req, res) => {
    const request = await WithdrawRequest.findByPk(req.params.id);
    if (!request) return error(res, "Request not found", 404);
    if (request.status !== 'PENDING') return error(res, "Request already processed", 400);

    const t = await sequelize.transaction();
    try {
        const wallet = await Wallet.findOne({ where: { userId: request.userId }, transaction: t });
        if (Number(wallet.balance) < Number(request.amount)) {
            await t.rollback();
            return error(res, "User has insufficient balance", 400);
        }

        request.status = 'APPROVED';
        request.approvedBy = req.user.id;
        request.processedAt = new Date();
        await request.save({ transaction: t });

        const balanceBefore = Number(wallet.balance);
        wallet.balance = Number(wallet.balance) - Number(request.amount);
        wallet.totalWithdraw = Number(wallet.totalWithdraw || 0) + Number(request.amount);
        await wallet.save({ transaction: t });

        await Transaction.create({
            userId: request.userId, type: 'WITHDRAW', amount: request.amount,
            balanceBefore, balanceAfter: Number(wallet.balance),
            description: `Withdraw request #${request.id} approved`,
            referenceId: String(request.id), referenceType: 'WITHDRAW_REQUEST'
        }, { transaction: t });

        await AuditLog.create({
            userId: req.user.id, action: "WITHDRAW_APPROVED",
            entity: "WithdrawRequest", entityId: request.id, amount: request.amount, ipAddress: req.ip
        }, { transaction: t });

        await t.commit();
        return success(res, null, "Withdrawal approved");
    } catch (err) {
        await t.rollback();
        throw err;
    }
}));

// POST /api/v1/banking/withdraw-requests/:id/reject
router.post("/withdraw-requests/:id/reject", authenticate, authorize('BANKING:APPROVE'), asyncHandler(async (req, res) => {
    const request = await WithdrawRequest.findByPk(req.params.id);
    if (!request) return error(res, "Request not found", 404);
    if (request.status !== 'PENDING') return error(res, "Already processed", 400);

    request.status = 'REJECTED';
    request.approvedBy = req.user.id;
    request.rejectedReason = req.body.reason || null;
    request.processedAt = new Date();
    await request.save();
    return success(res, null, "Withdrawal rejected");
}));

// POST /api/v1/banking/withdraw-requests/:id/hold
router.post("/withdraw-requests/:id/hold", authenticate, authorize('BANKING:APPROVE'), asyncHandler(async (req, res) => {
    const request = await WithdrawRequest.findByPk(req.params.id);
    if (!request) return error(res, "Request not found", 404);

    request.status = 'HOLD';
    await request.save();
    return success(res, null, "Withdrawal on hold");
}));

// ==================== AFFILIATE WITHDRAW (downline-scoped) ====================

// Internal helper: approve with wallet debit + transaction + audit log (mirrors /withdraw-requests/:id/approve)
async function _approveWithdrawCore(request, approverId, ip) {
    const t = await sequelize.transaction();
    try {
        const wallet = await Wallet.findOne({ where: { userId: request.userId }, transaction: t });
        if (Number(wallet.balance) < Number(request.amount)) {
            await t.rollback();
            return { ok: false, status: 400, message: "User has insufficient balance" };
        }

        request.status = 'APPROVED';
        request.approvedBy = approverId;
        request.processedAt = new Date();
        await request.save({ transaction: t });

        const balanceBefore = Number(wallet.balance);
        wallet.balance = Number(wallet.balance) - Number(request.amount);
        wallet.totalWithdraw = Number(wallet.totalWithdraw || 0) + Number(request.amount);
        await wallet.save({ transaction: t });

        await Transaction.create({
            userId: request.userId, type: 'WITHDRAW', amount: request.amount,
            balanceBefore, balanceAfter: Number(wallet.balance),
            description: `Withdraw request #${request.id} approved (affiliate)`,
            referenceId: String(request.id), referenceType: 'WITHDRAW_REQUEST'
        }, { transaction: t });

        await AuditLog.create({
            userId: approverId, action: "WITHDRAW_APPROVED",
            entity: "WithdrawRequest", entityId: request.id, amount: request.amount, ipAddress: ip
        }, { transaction: t });

        await t.commit();
        return { ok: true };
    } catch (err) {
        await t.rollback();
        throw err;
    }
}

// Date-range helper for summary cards
function _summaryRanges() {
    const now = new Date();
    const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
    const endOfDay   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };

    const todayStart = startOfDay(now);
    const todayEnd   = endOfDay(now);

    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const yStart = startOfDay(yesterday);
    const yEnd   = endOfDay(yesterday);

    // Week starts on Monday
    const day = now.getDay() || 7; // 1..7
    const thisWeekStart = startOfDay(new Date(now)); thisWeekStart.setDate(thisWeekStart.getDate() - (day - 1));
    const thisWeekEnd   = endOfDay(now);

    const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd   = new Date(thisWeekStart); lastWeekEnd.setMilliseconds(lastWeekEnd.getMilliseconds() - 1);

    const thisMonthStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const thisMonthEnd   = endOfDay(now);

    const lastMonthStart = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const lastMonthEnd   = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));

    return {
        today:    [todayStart, todayEnd],
        yesterday:[yStart, yEnd],
        thisWeek: [thisWeekStart, thisWeekEnd],
        lastWeek: [lastWeekStart, lastWeekEnd],
        thisMonth:[thisMonthStart, thisMonthEnd],
        lastMonth:[lastMonthStart, lastMonthEnd]
    };
}

// GET /api/v1/banking/affiliate/withdraw-requests
router.get("/affiliate/withdraw-requests", authenticate, authorize('BANKING:APPROVE_DOWNLINE'), asyncHandler(async (req, res) => {
    const { status, page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;

    const downlineIds = await getFullDownlineIds(req.user.id);
    if (!downlineIds.length) return paginated(res, [], 0, page, limit);

    const where = { userId: { [Op.in]: downlineIds } };
    if (status && status !== 'ALL') where.status = status;

    const userInclude = { model: User, attributes: ['id', 'username', 'role'] };
    if (search) {
        userInclude.where = { username: { [Op.like]: `%${search}%` } };
        userInclude.required = true;
    }

    const { count, rows } = await WithdrawRequest.findAndCountAll({
        where,
        include: [userInclude],
        offset: Number(offset), limit: Number(limit),
        order: [['createdAt', 'DESC']]
    });

    return paginated(res, rows, count, page, limit);
}));

// GET /api/v1/banking/affiliate/withdraw-summary
router.get("/affiliate/withdraw-summary", authenticate, authorize('BANKING:APPROVE_DOWNLINE'), asyncHandler(async (req, res) => {
    const downlineIds = await getFullDownlineIds(req.user.id);
    const empty = { today: 0, yesterday: 0, thisWeek: 0, lastWeek: 0, thisMonth: 0, lastMonth: 0 };
    if (!downlineIds.length) return success(res, empty);

    const ranges = _summaryRanges();
    const sumFor = async ([from, to]) => {
        const total = await WithdrawRequest.sum('amount', {
            where: {
                userId: { [Op.in]: downlineIds },
                createdAt: { [Op.between]: [from, to] }
            }
        });
        return Number(total || 0);
    };

    const result = {
        today:     await sumFor(ranges.today),
        yesterday: await sumFor(ranges.yesterday),
        thisWeek:  await sumFor(ranges.thisWeek),
        lastWeek:  await sumFor(ranges.lastWeek),
        thisMonth: await sumFor(ranges.thisMonth),
        lastMonth: await sumFor(ranges.lastMonth)
    };
    return success(res, result);
}));

// POST /api/v1/banking/affiliate/withdraw-requests/:id/approve
router.post("/affiliate/withdraw-requests/:id/approve", authenticate, authorize('BANKING:APPROVE_DOWNLINE'), asyncHandler(async (req, res) => {
    const request = await WithdrawRequest.findByPk(req.params.id);
    if (!request) return error(res, "Request not found", 404);
    if (request.status !== 'PENDING') return error(res, "Request already processed", 400);

    const downlineIds = await getFullDownlineIds(req.user.id);
    if (!downlineIds.includes(request.userId)) {
        return error(res, "Access denied — request is not from your downline", 403);
    }

    const result = await _approveWithdrawCore(request, req.user.id, req.ip);
    if (!result.ok) return error(res, result.message, result.status);
    return success(res, null, "Withdrawal approved");
}));

// POST /api/v1/banking/affiliate/withdraw-requests/:id/reject
router.post("/affiliate/withdraw-requests/:id/reject", authenticate, authorize('BANKING:APPROVE_DOWNLINE'), asyncHandler(async (req, res) => {
    const request = await WithdrawRequest.findByPk(req.params.id);
    if (!request) return error(res, "Request not found", 404);
    if (request.status !== 'PENDING') return error(res, "Already processed", 400);

    const downlineIds = await getFullDownlineIds(req.user.id);
    if (!downlineIds.includes(request.userId)) {
        return error(res, "Access denied — request is not from your downline", 403);
    }

    request.status = 'REJECTED';
    request.approvedBy = req.user.id;
    request.rejectedReason = req.body.reason || null;
    request.processedAt = new Date();
    await request.save();

    await AuditLog.create({
        userId: req.user.id, action: "WITHDRAW_REJECTED",
        entity: "WithdrawRequest", entityId: request.id, amount: request.amount,
        description: req.body.reason || null, ipAddress: req.ip
    });

    return success(res, null, "Withdrawal rejected");
}));

// POST /api/v1/banking/affiliate/withdraw-requests/:id/hold
router.post("/affiliate/withdraw-requests/:id/hold", authenticate, authorize('BANKING:APPROVE_DOWNLINE'), asyncHandler(async (req, res) => {
    const request = await WithdrawRequest.findByPk(req.params.id);
    if (!request) return error(res, "Request not found", 404);

    const downlineIds = await getFullDownlineIds(req.user.id);
    if (!downlineIds.includes(request.userId)) {
        return error(res, "Access denied — request is not from your downline", 403);
    }

    request.status = 'HOLD';
    await request.save();

    await AuditLog.create({
        userId: req.user.id, action: "WITHDRAW_HOLD",
        entity: "WithdrawRequest", entityId: request.id, amount: request.amount, ipAddress: req.ip
    });

    return success(res, null, "Withdrawal on hold");
}));

// ==================== BANKING METHODS ====================

// GET /api/v1/banking/methods
router.get("/methods", authenticate, asyncHandler(async (req, res) => {
    const methods = await BankingMethod.findAll({ where: { isActive: true }, order: [['createdAt', 'DESC']] });
    return success(res, methods);
}));

// POST /api/v1/banking/methods
router.post("/methods", authenticate, authorize('BANKING_METHOD:CREATE'), validate(bankingMethodSchema), asyncHandler(async (req, res) => {
    const { name, type, accountNumber, accountName, instructions, isActive, minAmount, maxAmount, logoUrl } = req.body;
    const method = await BankingMethod.create({ name, type, accountNumber, accountName, instructions, isActive, minAmount, maxAmount, logoUrl, createdBy: req.user.id });
    return success(res, method, "Banking method created", 201);
}));

// PATCH /api/v1/banking/methods/:id
router.patch("/methods/:id", authenticate, authorize('BANKING_METHOD:EDIT'), asyncHandler(async (req, res) => {
    const method = await BankingMethod.findByPk(req.params.id);
    if (!method) return error(res, "Method not found", 404);

    const { name, type, accountNumber, accountName, instructions, isActive, minAmount, maxAmount, logoUrl } = req.body;
    await method.update({ name, type, accountNumber, accountName, instructions, isActive, minAmount, maxAmount, logoUrl });
    return success(res, method, "Banking method updated");
}));

// DELETE /api/v1/banking/methods/:id
router.delete("/methods/:id", authenticate, authorize('BANKING_METHOD:DELETE'), asyncHandler(async (req, res) => {
    const method = await BankingMethod.findByPk(req.params.id);
    if (!method) return error(res, "Method not found", 404);

    await method.destroy();
    return success(res, null, "Banking method deleted");
}));

module.exports = router;
