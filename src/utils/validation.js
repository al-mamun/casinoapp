const Joi = require('joi');

// Reusable validation middleware factory
const validate = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
        if (error) {
            const errors = error.details.map(d => ({ field: d.path.join('.'), message: d.message }));
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errorCode: 'VALIDATION_ERROR',
                errors
            });
        }
        req.body = value;
        next();
    };
};

const validateQuery = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.query, { abortEarly: false, stripUnknown: true });
        if (error) {
            const errors = error.details.map(d => ({ field: d.path.join('.'), message: d.message }));
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errorCode: 'VALIDATION_ERROR',
                errors
            });
        }
        req.query = value;
        next();
    };
};

// ==================== AUTH SCHEMAS ====================

const loginSchema = Joi.object({
    username: Joi.string().trim().min(3).max(50).required(),
    password: Joi.string().min(4).max(100).required()
});

const changePasswordSchema = Joi.object({
    oldPassword: Joi.string().min(4).required(),
    newPassword: Joi.string().min(6).max(100).required()
});

const changeUserPasswordSchema = Joi.object({
    userId: Joi.number().integer().required(),
    newPassword: Joi.string().min(6).max(100).required()
});

// ==================== USER SCHEMAS ====================

const createUserSchema = Joi.object({
    username: Joi.string().trim().min(3).max(50).required(),
    password: Joi.string().min(4).max(100).required(),
    roleToCreate: Joi.string().trim().uppercase().replace(/\s+/g, "_").valid(
        'MOTHER_PANEL', 'WHITE_LABEL', 'SUPER_ADMIN', 'ADMIN',
        'B2C_SUB_ADMIN', 'B2B_SUB_ADMIN', 'SENIOR_AFFILIATE',
        'AFFILIATE', 'SUPER_AGENT', 'MASTER_AGENT', 'AGENT', 'PLAYER'
    ),
    role_to_create: Joi.string().trim().uppercase().replace(/\s+/g, "_").valid(
        'MOTHER_PANEL', 'WHITE_LABEL', 'SUPER_ADMIN', 'ADMIN',
        'B2C_SUB_ADMIN', 'B2B_SUB_ADMIN', 'SENIOR_AFFILIATE',
        'AFFILIATE', 'SUPER_AGENT', 'MASTER_AGENT', 'AGENT', 'PLAYER'
    ),
    phone: Joi.string().allow('', null),
    email: Joi.string().email().allow('', null),
    fullName: Joi.string().allow('', null),
    commissionRate: Joi.number().min(0).max(100).default(0)
}).or('roleToCreate', 'role_to_create');

const updateUserStatusSchema = Joi.object({
    status: Joi.string().valid('active', 'inactive', 'blocked').required()
});

// ==================== WALLET SCHEMAS ====================

const depositSchema = Joi.object({
    userId: Joi.number().integer().required(),
    amount: Joi.number().positive().required(),
    description: Joi.string().allow('', null)
});

const transferSchema = Joi.object({
    toUserId: Joi.number().integer().required(),
    amount: Joi.number().positive().required(),
    description: Joi.string().allow('', null)
});

// ==================== BET SCHEMAS ====================

const placeBetSchema = Joi.object({
    matchId: Joi.number().integer().required(),
    marketId: Joi.number().integer().required(),
    selection: Joi.string().required(),
    odds: Joi.number().positive().required(),
    stake: Joi.number().positive().max(500000).required()
});

// ==================== MATCH SCHEMAS ====================

const createMatchSchema = Joi.object({
    leagueId: Joi.number().integer().required(),
    teamA: Joi.string().required(),
    teamB: Joi.string().required(),
    startTime: Joi.date().required(),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'BLOCKED').default('ACTIVE')
});

const createMarketSchema = Joi.object({
    name: Joi.string().required(),
    type: Joi.string().valid('WINNER', 'OVER_UNDER', 'HANDICAP', 'FANCY').default('WINNER')
});

// ==================== RESULT SCHEMAS ====================

const declareResultSchema = Joi.object({
    matchId: Joi.number().integer().required(),
    marketId: Joi.number().integer().required(),
    winningSelection: Joi.string().required()
});

// ==================== BANKING SCHEMAS ====================

const bankingMethodSchema = Joi.object({
    name: Joi.string().required(),
    type: Joi.string().valid('BKASH', 'NAGAD', 'ROCKET', 'CRYPTO', 'BANK').required(),
    accountNumber: Joi.string().required(),
    accountName: Joi.string().allow('', null),
    isActive: Joi.boolean().default(true)
});

const depositRequestSchema = Joi.object({
    amount: Joi.number().positive().required(),
    methodId: Joi.number().integer().required(),
    transactionId: Joi.string().allow('', null),
    proofImage: Joi.string().allow('', null)
});

const withdrawRequestSchema = Joi.object({
    amount: Joi.number().positive().required(),
    methodId: Joi.number().integer().required(),
    accountNumber: Joi.string().required()
});

// ==================== MESSAGE SCHEMAS ====================

const messageSchema = Joi.object({
    type: Joi.string().valid('USER', 'HYPER', 'IMPORTANT', 'IMAGE').required(),
    title: Joi.string().required(),
    content: Joi.string().allow('', null),
    targetUserId: Joi.number().integer().allow(null),
    imageUrl: Joi.string().allow('', null)
});

// ==================== SETTINGS SCHEMAS ====================

const settingsSchema = Joi.object({
    key: Joi.string().required(),
    value: Joi.any().required(),
    category: Joi.string().allow('', null)
});

const riskLimitsSchema = Joi.object({
    maxBet: Joi.number().positive().allow(null),
    maxLoss: Joi.number().positive().allow(null),
    maxExposure: Joi.number().positive().allow(null),
    maxLiability: Joi.number().positive().allow(null)
});

// ==================== PAGINATION SCHEMA ====================

const paginationSchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().allow('', null),
    status: Joi.string().allow('', null),
    sortBy: Joi.string().allow('', null),
    sortOrder: Joi.string().valid('ASC', 'DESC').default('DESC')
});

module.exports = {
    validate,
    validateQuery,
    loginSchema,
    changePasswordSchema,
    changeUserPasswordSchema,
    createUserSchema,
    updateUserStatusSchema,
    depositSchema,
    transferSchema,
    placeBetSchema,
    createMatchSchema,
    createMarketSchema,
    declareResultSchema,
    bankingMethodSchema,
    depositRequestSchema,
    withdrawRequestSchema,
    messageSchema,
    settingsSchema,
    riskLimitsSchema,
    paginationSchema
};
