const Wallet = require("../modules/wallet/wallet.model");
const User = require("../modules/user/user.model");
const Transaction = require("../modules/transaction/transaction.model");
const AuditLog = require("./audit.engine");

const COMMISSION_RATES = {
    OWNER: 0.10,
    MOTHER_PANEL: 0.08,
    WHITE_LABEL: 0.07,
    SUPER_ADMIN: 0.06,
    ADMIN: 0.05,
    B2C_SUB_ADMIN: 0.04,
    B2B_SUB_ADMIN: 0.04,
    SENIOR_AFFILIATE: 0.03,
    AFFILIATE: 0.03,
    SUPER_AGENT: 0.20,
    MASTER_AGENT: 0.30
};

const MAX_HIERARCHY_DEPTH = 12;

// Distribute commission up the hierarchy from a player's profit
exports.distributeCommission = async (playerId, profitAmount, transaction) => {
    const player = await User.findByPk(playerId);
    if (!player || !player.parentId) return;

    let currentParentId = player.parentId;
    let depth = 0;
    const distributions = [];

    while (currentParentId && depth < MAX_HIERARCHY_DEPTH) {
        const parent = await User.findByPk(currentParentId);
        if (!parent) break;

        const rate = parent.commission_rate > 0
            ? parent.commission_rate / 100
            : (COMMISSION_RATES[parent.role] || 0);

        const commission = profitAmount * rate;

        if (commission > 0) {
            const wallet = await Wallet.findOne({
                where: { userId: parent.id },
                transaction
            });

            if (wallet) {
                const balanceBefore = Number(wallet.balance);
                wallet.balance = Number(wallet.balance) + commission;
                await wallet.save({ transaction });

                await Transaction.create({
                    userId: parent.id,
                    type: 'COMMISSION',
                    amount: commission,
                    balanceBefore,
                    balanceAfter: Number(wallet.balance),
                    fromId: playerId,
                    description: `Commission from user #${playerId} (${parent.role} ${rate * 100}%)`,
                    referenceType: 'COMMISSION'
                }, { transaction });

                distributions.push({
                    userId: parent.id,
                    role: parent.role,
                    rate,
                    commission
                });
            }
        }

        currentParentId = parent.parentId;
        depth++;
    }

    return distributions;
};

// Get total commissions earned by a user
exports.getUserCommissions = async (userId) => {
    const total = await Transaction.sum('amount', {
        where: { userId, type: 'COMMISSION' }
    });
    return Number(total) || 0;
};

// Get commission breakdown by period
exports.getCommissionsByPeriod = async (userId, startDate, endDate) => {
    const { Op } = require("sequelize");
    const where = { userId, type: 'COMMISSION' };
    if (startDate) where.createdAt = { [Op.gte]: startDate };
    if (endDate) where.createdAt = { ...where.createdAt, [Op.lte]: endDate };

    return await Transaction.findAll({
        where,
        order: [['createdAt', 'DESC']]
    });
};
