const router = require("express").Router();
const { CompanyPayment, Transaction } = require("../../models");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { success, error, paginated } = require("../../utils/apiResponse");
const AuditLog = require("../../core/audit.engine");

// GET /api/v1/company-payment/summary
router.get("/summary", authenticate, authorize('COMPANY_PAYMENT:VIEW'), asyncHandler(async (req, res) => {
    const { fn, col } = require("sequelize");

    const totalSettlement = await CompanyPayment.sum('amount', { where: { type: 'SETTLEMENT', status: 'COMPLETED' } });
    const totalCommissionPayout = await CompanyPayment.sum('amount', { where: { type: 'COMMISSION_PAYOUT', status: 'COMPLETED' } });
    const pendingPayments = await CompanyPayment.count({ where: { status: 'PENDING' } });

    const totalDeposits = await Transaction.sum('amount', { where: { type: 'DEPOSIT', status: 'COMPLETED' } });
    const totalWithdrawals = await Transaction.sum('amount', { where: { type: 'WITHDRAW', status: 'COMPLETED' } });

    return success(res, {
        totalSettlement: Number(totalSettlement) || 0,
        totalCommissionPayout: Number(totalCommissionPayout) || 0,
        pendingPayments,
        totalDeposits: Number(totalDeposits) || 0,
        totalWithdrawals: Number(totalWithdrawals) || 0,
        netPosition: (Number(totalDeposits) || 0) - (Number(totalWithdrawals) || 0)
    });
}));

// GET /api/v1/company-payment/ledger
router.get("/ledger", authenticate, authorize('COMPANY_PAYMENT:VIEW'), asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, type } = req.query;
    const offset = (page - 1) * limit;
    const where = {};
    if (type) where.type = type;

    const { count, rows } = await CompanyPayment.findAndCountAll({
        where,
        offset: Number(offset), limit: Number(limit),
        order: [['createdAt', 'DESC']]
    });

    return paginated(res, rows, count, page, limit);
}));

// POST /api/v1/company-payment/settlement
router.post("/settlement", authenticate, authorize('COMPANY_PAYMENT:SETTLE'), asyncHandler(async (req, res) => {
    const { amount, description, reference } = req.body;

    const payment = await CompanyPayment.create({
        type: 'SETTLEMENT', amount, description, reference,
        createdBy: req.user.id, status: 'COMPLETED'
    });

    await AuditLog.create({
        userId: req.user.id, action: "COMPANY_SETTLEMENT",
        entity: "CompanyPayment", entityId: payment.id, amount,
        description: description || 'Company settlement', ipAddress: req.ip
    });

    return success(res, payment, "Settlement recorded", 201);
}));

// POST /api/v1/company-payment/commission-payout
router.post("/commission-payout", authenticate, authorize('COMPANY_PAYMENT:PAYOUT'), asyncHandler(async (req, res) => {
    const { amount, description, reference } = req.body;

    const payment = await CompanyPayment.create({
        type: 'COMMISSION_PAYOUT', amount, description, reference,
        createdBy: req.user.id, status: 'COMPLETED'
    });

    await AuditLog.create({
        userId: req.user.id, action: "COMMISSION_PAYOUT",
        entity: "CompanyPayment", entityId: payment.id, amount, ipAddress: req.ip
    });

    return success(res, payment, "Commission payout recorded", 201);
}));

module.exports = router;
