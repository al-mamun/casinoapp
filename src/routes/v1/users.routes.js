const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { Op } = require("sequelize");
const { User, Wallet, Role, PlayerStats } = require("../../models");
const { authenticate, destroyAllUserSessions } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { validate, validateQuery, createUserSchema, changeUserPasswordSchema, depositSchema, paginationSchema } = require("../../utils/validation");
const { success, error, paginated } = require("../../utils/apiResponse");
const { canCreate } = require("../../utils/panelHierarchy");
const AuditLog = require("../../core/audit.engine");
const { getFullDownlineIds, clearCache } = require("../../services/hierarchyService");

// GET /api/v1/users/downline
router.get("/downline", authenticate, authorize('DOWNLINE:VIEW'), asyncHandler(async (req, res) => {
    const disableRbac = String(process.env.DISABLE_RBAC || "false").toLowerCase() === "true";
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 1000);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();

    const where = { isDeleted: false };
    if (status && status !== "all") where.status = status;

    if (disableRbac || req.user.role === 'OWNER') {
        where.id = { [Op.ne]: req.user.id };
    } else {
        const downlineIds = await getFullDownlineIds(req.user.id);
        if (!downlineIds.length) {
            return res.status(200).json({
                success: true,
                message: "Downline list",
                data: [],
                meta: {
                    page,
                    limit,
                    total: 0,
                    totalPages: 0,
                    summary: {
                        totalUsers: 0,
                        totalBalance: 0,
                        playerBalance: 0,
                        activeUsers: 0,
                        blockedUsers: 0
                    }
                }
            });
        }
        where.id = { [Op.in]: downlineIds };
    }

    if (search) {
        where[Op.or] = [
            { username: { [Op.like]: `%${search}%` } },
            { fullName: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { phone: { [Op.like]: `%${search}%` } }
        ];
        if (!Number.isNaN(Number(search))) {
            where[Op.or].push({ id: Number(search) });
        }
    }

    const { count, rows } = await User.findAndCountAll({
        where,
        include: [
            { model: Wallet, as: 'wallet' },
            { model: User, as: 'parent', attributes: ['id', 'username', 'role'], required: false }
        ],
        attributes: { exclude: ['password'] },
        offset,
        limit,
        order: [['createdAt', 'DESC']]
    });

    const data = rows.map((user) => {
        const plain = user.toJSON();
        const balance = Number(plain.wallet?.balance || 0);
        return {
            ...plain,
            wallet: plain.wallet || { balance: 0 },
            availableBalance: balance,
            playerBalance: plain.role === 'PLAYER' ? balance : 0,
            netExposure: Number(plain.netExposure || 0),
            refPL: Number(plain.refPL || 0)
        };
    });

    const summary = data.reduce((acc, user) => {
        const balance = Number(user.wallet?.balance || 0);
        acc.totalUsers += 1;
        acc.totalBalance += balance;
        if (user.role === 'PLAYER') acc.playerBalance += balance;
        if (String(user.status || '').toLowerCase() === 'active') acc.activeUsers += 1;
        if (String(user.status || '').toLowerCase() === 'blocked') acc.blockedUsers += 1;
        return acc;
    }, {
        totalUsers: 0,
        totalBalance: 0,
        playerBalance: 0,
        activeUsers: 0,
        blockedUsers: 0
    });

    return res.status(200).json({
        success: true,
        message: "Downline list",
        data,
        meta: {
            page,
            limit,
            total: count,
            totalPages: Math.ceil(count / limit),
            summary
        }
    });
}));

// GET /api/v1/users/search
router.get("/search", authenticate, authorize('DOWNLINE:VIEW'), asyncHandler(async (req, res) => {
    const { q } = req.query;
    if (!q) return error(res, "Search query required", 400);

    const where = { isDeleted: false };
    if (req.user.role === 'OWNER') {
        where.id = { [Op.ne]: req.user.id };
    } else {
        const downlineIds = await getFullDownlineIds(req.user.id);
        if (!downlineIds.length) return success(res, [], "Found 0 users");
        where.id = { [Op.in]: downlineIds };
    }

    where[Op.or] = [
        { username: { [Op.like]: `%${q}%` } },
        { fullName: { [Op.like]: `%${q}%` } },
        { email: { [Op.like]: `%${q}%` } },
        { phone: { [Op.like]: `%${q}%` } }
    ];

    // Also try exact ID match
    if (!isNaN(q)) {
        where[Op.or].push({ id: Number(q) });
    }

    const users = await User.findAll({
        where,
        include: [{ model: Wallet, as: 'wallet' }],
        attributes: { exclude: ['password'] },
        limit: 50
    });

    return success(res, users, `Found ${users.length} users`);
}));

// POST /api/v1/users/create
router.post("/create", authenticate, authorize('DOWNLINE:CREATE'), validate(createUserSchema), asyncHandler(async (req, res) => {
    const disableRbac = String(process.env.DISABLE_RBAC || "false").toLowerCase() === "true";
    const { username, password, phone, email, fullName, commissionRate } = req.body;
    const roleToCreate = String(req.body.roleToCreate || req.body.role_to_create || "")
        .trim()
        .replace(/\s+/g, "_")
        .toUpperCase();
    const creatorRole = req.user.role;

    // Check hierarchy permission
    if (!disableRbac && !canCreate(creatorRole, roleToCreate)) {
        return error(res, `${creatorRole} cannot create ${roleToCreate}`, 403, "PERMISSION_DENIED");
    }

    // Check if username exists
    const existing = await User.findOne({ where: { username } });
    if (existing) return error(res, "Username already exists", 409, "CONFLICT");

    const roleRecord = await Role.findOne({ where: { name: roleToCreate } });
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate referral code
    const referralCode = `${roleToCreate.substring(0, 3)}-${Date.now().toString(36)}`.toUpperCase();

    const newUser = await User.create({
        username,
        password: hashedPassword,
        role: roleToCreate,
        roleId: roleRecord ? roleRecord.id : null,
        parentId: req.user.id,
        phone,
        email,
        fullName,
        commission_rate: commissionRate || 0,
        referralCode
    });

    // Create wallet for new user
    await Wallet.create({ userId: newUser.id, balance: 0 });

    // Create player stats if player
    if (roleToCreate === 'PLAYER') {
        await PlayerStats.create({ userId: newUser.id });
    }

    clearCache(req.user.id);

    await AuditLog.create({
        userId: req.user.id,
        action: "USER_CREATED",
        entity: "User",
        entityId: newUser.id,
        description: `Created ${roleToCreate}: ${username}`,
        ipAddress: req.ip
    });

    return success(res, {
        id: newUser.id,
        username: newUser.username,
        role: newUser.role,
        referralCode: newUser.referralCode
    }, "User created successfully", 201);
}));

// ==================== AFFILIATE KYC (downline-scoped) ====================

const KYC_STATUS_VALUES = ['NOT_SUBMITTED', 'SUBMITTED', 'VERIFIED', 'APPROVED', 'REJECTED'];

// GET /api/v1/users/affiliate/players
router.get("/affiliate/players", authenticate, authorize('USER:KYC_APPROVE_DOWNLINE'), asyncHandler(async (req, res) => {
    const { status, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const downlineIds = await getFullDownlineIds(req.user.id);
    if (!downlineIds.length) return paginated(res, [], 0, page, limit, "Players list");

    const where = {
        id: { [Op.in]: downlineIds },
        role: 'PLAYER',
        isDeleted: false
    };
    if (status && status !== 'ALL') where.kycStatus = status;
    if (search) {
        where[Op.or] = [
            { username: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { fullName: { [Op.like]: `%${search}%` } }
        ];
    }

    const { count, rows } = await User.findAndCountAll({
        where,
        attributes: { exclude: ['password'] },
        offset: Number(offset), limit: Number(limit),
        order: [['createdAt', 'DESC']]
    });

    return paginated(res, rows, count, page, limit, "Players list");
}));

// GET /api/v1/users/:id/kyc
router.get("/:id/kyc", authenticate, authorize('USER:KYC_APPROVE_DOWNLINE'), asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    const user = await User.findByPk(targetId, {
        attributes: ['id', 'username', 'fullName', 'email', 'phone', 'kycStatus', 'kycVerified', 'kycApproved',
                     'kycSubmittedAt', 'kycVerifiedAt', 'kycApprovedAt', 'kycRejectedReason', 'kycDocuments']
    });
    if (!user) return error(res, "User not found", 404);

    if (req.user.role !== 'OWNER') {
        const downlineIds = await getFullDownlineIds(req.user.id);
        if (!downlineIds.includes(targetId)) {
            return error(res, "Access denied — user is not in your downline", 403);
        }
    }

    return success(res, user);
}));

// PATCH /api/v1/users/:id/kyc
router.patch("/:id/kyc", authenticate, authorize('USER:KYC_APPROVE_DOWNLINE'), asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    const user = await User.findByPk(targetId);
    if (!user) return error(res, "User not found", 404);

    if (req.user.role !== 'OWNER') {
        const downlineIds = await getFullDownlineIds(req.user.id);
        if (!downlineIds.includes(targetId)) {
            return error(res, "Access denied — user is not in your downline", 403);
        }
    }

    const { kycStatus, kycVerified, kycApproved, kycRejectedReason } = req.body;
    const before = {
        kycStatus: user.kycStatus, kycVerified: user.kycVerified,
        kycApproved: user.kycApproved, kycRejectedReason: user.kycRejectedReason
    };

    if (kycStatus !== undefined) {
        if (!KYC_STATUS_VALUES.includes(kycStatus)) {
            return error(res, `Invalid kycStatus. Allowed: ${KYC_STATUS_VALUES.join(', ')}`, 400);
        }
        user.kycStatus = kycStatus;
    }

    const now = new Date();
    if (kycVerified !== undefined) {
        const v = !!kycVerified;
        if (v && !user.kycVerified) user.kycVerifiedAt = now;
        user.kycVerified = v;
    }
    if (kycApproved !== undefined) {
        const a = !!kycApproved;
        if (a && !user.kycApproved) {
            user.kycApprovedAt = now;
            if (!kycStatus) user.kycStatus = 'APPROVED';
        }
        user.kycApproved = a;
    }
    if (kycRejectedReason !== undefined) {
        user.kycRejectedReason = kycRejectedReason || null;
    }

    await user.save();

    await AuditLog.create({
        userId: req.user.id,
        action: "KYC_UPDATED",
        entity: "User",
        entityId: user.id,
        description: `KYC updated for ${user.username} | before=${JSON.stringify(before)} after=${JSON.stringify({ kycStatus: user.kycStatus, kycVerified: user.kycVerified, kycApproved: user.kycApproved, kycRejectedReason: user.kycRejectedReason })}`,
        ipAddress: req.ip
    });

    return success(res, {
        id: user.id, kycStatus: user.kycStatus, kycVerified: user.kycVerified,
        kycApproved: user.kycApproved, kycVerifiedAt: user.kycVerifiedAt,
        kycApprovedAt: user.kycApprovedAt, kycRejectedReason: user.kycRejectedReason
    }, "KYC updated");
}));

// GET /api/v1/users/:id — own profile (any authenticated user) or admin lookup
router.get("/:id", authenticate, asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    const requesterId = Number(req.user.id);
    const isSelf = targetId === requesterId;
    const disableRbac = String(process.env.DISABLE_RBAC || "false").toLowerCase() === "true";
    const isAdmin = disableRbac || ["OWNER","MOTHER_PANEL","WHITE_LABEL","SUPER_ADMIN","ADMIN"].includes(req.user.actualRole || req.user.role);

    // Non-admin users may only view their own profile
    if (!isSelf && !isAdmin) {
        return res.status(403).json({ success: false, message: "Permission denied", errorCode: "PERMISSION_DENIED" });
    }

    const user = await User.findByPk(targetId, {
        attributes: { exclude: ['password'] },
        include: [{ model: Wallet, as: 'wallet' }]
    });

    if (!user) return error(res, "User not found", 404);
    return success(res, user);
}));

// GET /api/v1/users/:id/wallet
router.get("/:id/wallet", authenticate, authorize('BANKING:VIEW'), asyncHandler(async (req, res) => {
    const wallet = await Wallet.findOne({ where: { userId: req.params.id } });
    if (!wallet) return error(res, "Wallet not found", 404);
    return success(res, wallet);
}));

// PATCH /api/v1/users/:id/status
router.patch("/:id/status", authenticate, authorize('USER:BLOCK'), asyncHandler(async (req, res) => {
    const { status } = req.body;
    const user = await User.findByPk(req.params.id);
    if (!user) return error(res, "User not found", 404);

    user.status = status;
    if (status === 'inactive') user.isActive = false;
    if (status === 'active') user.isActive = true;
    if (status === 'blocked') { user.isActive = false; user.status = 'blocked'; }

    await user.save();

    await AuditLog.create({
        userId: req.user.id, action: "USER_STATUS_CHANGED",
        entity: "User", entityId: user.id,
        description: `Status changed to ${status}`, ipAddress: req.ip
    });

    return success(res, null, `User status changed to ${status}`);
}));

// PATCH /api/v1/users/:id/commission
router.patch("/:id/commission", authenticate, authorize('DOWNLINE:EDIT'), asyncHandler(async (req, res) => {
    const { commissionRate } = req.body;
    const rate = Number(commissionRate);

    if (isNaN(rate) || rate < 0 || rate > 100) {
        return error(res, "Commission rate must be a number between 0 and 100", 400);
    }

    const user = await User.findByPk(req.params.id);
    if (!user) return error(res, "User not found", 404);

    // Only the direct creator (parent) or OWNER may change commission
    if (req.user.role !== 'OWNER' && user.parentId !== req.user.id) {
        return error(res, "You can only modify commission for users you directly created", 403);
    }

    const previous = user.commission_rate;
    user.commission_rate = rate;
    await user.save();

    await AuditLog.create({
        userId: req.user.id, action: "COMMISSION_UPDATED",
        entity: "User", entityId: user.id,
        description: `Commission changed from ${previous}% to ${rate}% for ${user.username}`, ipAddress: req.ip
    });

    return success(res, { commission_rate: rate }, "Commission rate updated");
}));

// PATCH /api/v1/users/:id/bet-lock
router.patch("/:id/bet-lock", authenticate, authorize('USER:BLOCK'), asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.id);
    if (!user) return error(res, "User not found", 404);

    user.isBetLocked = !user.isBetLocked;
    await user.save();

    await AuditLog.create({
        userId: req.user.id, action: "BET_LOCK_TOGGLED",
        entity: "User", entityId: user.id,
        description: `Bet lock: ${user.isBetLocked}`, ipAddress: req.ip
    });

    return success(res, { isBetLocked: user.isBetLocked }, `Bet lock ${user.isBetLocked ? 'enabled' : 'disabled'}`);
}));

// PATCH /api/v1/users/:id/restore
router.patch("/:id/restore", authenticate, authorize('USER:RESTORE'), asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.id);
    if (!user) return error(res, "User not found", 404);

    user.isDeleted = false;
    user.isActive = true;
    user.status = 'active';
    await user.save();

    return success(res, null, "User restored");
}));

// DELETE /api/v1/users/:id (soft delete)
router.delete("/:id", authenticate, authorize('USER:DELETE'), asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.id);
    if (!user) return error(res, "User not found", 404);

    user.isDeleted = true;
    user.isActive = false;
    user.status = 'deleted';
    await user.save();

    await AuditLog.create({
        userId: req.user.id, action: "USER_DELETED",
        entity: "User", entityId: user.id,
        description: `Soft deleted user: ${user.username}`, ipAddress: req.ip
    });

    return success(res, null, "User deleted");
}));

// POST /api/v1/users/:id/change-password (admin changes user password)
router.post("/:id/change-password", authenticate, authorize('DOWNLINE:EDIT'), validate(changeUserPasswordSchema), asyncHandler(async (req, res) => {
    const { newPassword } = req.body;
    const user = await User.findByPk(req.params.id);
    if (!user) return error(res, "User not found", 404);

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // Revoke ALL sessions for the target user (admin override — no exceptions)
    await destroyAllUserSessions(user.id);

    await AuditLog.create({
        userId: req.user.id, action: "PASSWORD_CHANGED",
        entity: "User", entityId: user.id,
        description: `Admin changed password for ${user.username}`, ipAddress: req.ip
    });

    return success(res, null, "Password changed");
}));

// GET /api/v1/users/inactive
router.get("/filter/inactive", authenticate, authorize('USER:VIEW'), asyncHandler(async (req, res) => {
    const users = await User.findAll({
        where: { isActive: false, isDeleted: false },
        attributes: { exclude: ['password'] },
        include: [{ model: Wallet, as: 'wallet' }]
    });
    return success(res, users);
}));

// GET /api/v1/users/filter/bet-locked
router.get("/filter/bet-locked", authenticate, authorize('USER:VIEW'), asyncHandler(async (req, res) => {
    const users = await User.findAll({
        where: { isBetLocked: true, isDeleted: false },
        attributes: { exclude: ['password'] },
        include: [{ model: Wallet, as: 'wallet' }]
    });
    return success(res, users);
}));

// GET /api/v1/users/filter/deleted
router.get("/filter/deleted", authenticate, authorize('USER:VIEW'), asyncHandler(async (req, res) => {
    const users = await User.findAll({
        where: { isDeleted: true },
        attributes: { exclude: ['password'] }
    });
    return success(res, users);
}));

module.exports = router;
