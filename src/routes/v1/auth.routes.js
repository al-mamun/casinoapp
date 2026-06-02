const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { User, Wallet, Role } = require("../../models");
const { authenticate, generateToken, createSession, getActiveSessions, destroySession } = require("../../middleware/auth.middleware");
const { asyncHandler } = require("../../middleware/errorHandler");
const { validate, loginSchema, changePasswordSchema } = require("../../utils/validation");
const { success, error } = require("../../utils/apiResponse");
const AuditLog = require("../../core/audit.engine");
const { getVisibleMenus } = require("../../utils/rolePermissions");

// POST /api/v1/auth/login
router.post("/login", validate(loginSchema), asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const loginId = String(username || "").trim();
    const normalizedLoginId = loginId.toLowerCase();
    const walletInclude = [{ model: Wallet, as: 'wallet' }];

    let user = await User.findOne({
        where: { username: loginId, isDeleted: false },
        include: walletInclude
    });

    if (!user && loginId.includes("@")) {
        user = await User.findOne({
            where: { email: loginId, isDeleted: false },
            include: walletInclude
        });
    }

    if (!user) {
        const candidates = await User.findAll({
            where: { isDeleted: false },
            attributes: ["id", "username", "email"]
        });
        const matched = candidates.find((candidate) => {
            const candidateUsername = String(candidate.username || "").trim().toLowerCase();
            const candidateEmail = String(candidate.email || "").trim().toLowerCase();
            return candidateUsername === normalizedLoginId || candidateEmail === normalizedLoginId;
        });

        if (matched) {
            user = await User.findByPk(matched.id, { include: walletInclude });
        }
    }

    if (!user) return error(res, "User not found", 404, "NOT_FOUND");
    if (!user.isActive) return error(res, "Account is inactive", 403, "ACCOUNT_INACTIVE");

    const match = await bcrypt.compare(password, user.password);
    if (!match) return error(res, "Wrong password", 401, "WRONG_PASSWORD");

    const token = generateToken(user);

    // Create session (with concurrent session enforcement)
    const sessionResult = await createSession(user.id, token, req.ip, req.headers['user-agent']);

    // Update last login
    user.lastLoginAt = new Date();
    user.lastLoginIp = req.ip;
    await user.save();

    await AuditLog.create({
        userId: user.id,
        action: "LOGIN_SUCCESS",
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
    });

    const menuRole = user.fullAccessMode ? 'OWNER' : user.role;

    return success(res, {
        token,
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            roleId: user.roleId,
            fullName: user.fullName,
            balance: user.wallet?.balance || 0,
            reviewMode: !!user.reviewMode,
            fullAccessMode: !!user.fullAccessMode
        },
        menus: getVisibleMenus(menuRole),
        activeSessions: sessionResult.activeSessions || 1
    }, "Login successful");
}));

// GET /api/v1/auth/me
router.get("/me", authenticate, asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.user.id, {
        attributes: { exclude: ['password'] },
        include: [
            { model: Wallet, as: 'wallet' },
            { model: Role, as: 'roleInfo' }
        ]
    });

    if (!user) return error(res, "User not found", 404);

    const menuRole = user.fullAccessMode ? 'OWNER' : user.role;

    return success(res, {
        ...user.toJSON(),
        menus: getVisibleMenus(menuRole)
    });
}));

// PATCH /api/v1/auth/change-password
router.patch("/change-password", authenticate, validate(changePasswordSchema), asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findByPk(req.user.id);

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return error(res, "Current password is wrong", 400, "WRONG_PASSWORD");

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    await AuditLog.create({
        userId: user.id,
        action: "PASSWORD_CHANGED",
        description: "User changed own password",
        ipAddress: req.ip
    });

    return success(res, null, "Password changed successfully");
}));

// GET /api/v1/auth/me/sessions — real active sessions
router.get("/me/sessions", authenticate, asyncHandler(async (req, res) => {
    const sessions = await getActiveSessions(req.user.id);
    return success(res, sessions, "Active sessions");
}));

// POST /api/v1/auth/logout — destroy current session
router.post("/logout", authenticate, asyncHandler(async (req, res) => {
    await destroySession(req.token);
    return success(res, null, "Logged out successfully");
}));

module.exports = router;
