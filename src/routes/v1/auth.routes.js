const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { User, Wallet, Role } = require("../../models");
const { authenticate, generateToken, createSession, getActiveSessions, destroySession, destroyAllUserSessions } = require("../../middleware/auth.middleware");
const { asyncHandler } = require("../../middleware/errorHandler");
const { validate, loginSchema, changePasswordSchema } = require("../../utils/validation");
const { success, error } = require("../../utils/apiResponse");
const AuditLog = require("../../core/audit.engine");
const { getVisibleMenus } = require("../../utils/rolePermissions");

// POST /api/v1/auth/register — public self-registration, always creates PLAYER
router.post("/register", asyncHandler(async (req, res) => {
    const { username, password, referral_code, referralCode, fullName, phone, email } = req.body || {};

    if (!username || !password) return error(res, "Username and password are required", 400);
    if (String(username).trim().length < 4) return error(res, "Username must be at least 4 characters", 400);
    if (String(password).length < 6) return error(res, "Password must be at least 6 characters", 400);

    const exists = await User.findOne({ where: { username: String(username).trim() } });
    if (exists) return error(res, "Username already taken", 409, "USERNAME_EXISTS");

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
        username:     String(username).trim(),
        password:     hashed,
        role:         'PLAYER',
        fullName:     fullName || String(username).trim(),
        phone:        phone  || null,
        email:        email  || null,
        referralCode: `PX${Date.now().toString().slice(-7)}`,
        referredBy:   referral_code || referralCode || null,
        isActive:     true,
        status:       'active',
    });

    await Wallet.create({ userId: user.id, balance: 0 });

    const token = generateToken(user);
    await createSession(user.id, token, req.ip, req.headers['user-agent']);

    await AuditLog.create({
        userId: user.id,
        action: 'REGISTER',
        description: `New player registered: ${user.username}`,
        ipAddress: req.ip,
    });

    return success(res, {
        token,
        user: {
            id:       user.id,
            username: user.username,
            role:     user.role,
            fullName: user.fullName,
            balance:  0,
        },
        menus: getVisibleMenus('PLAYER'),
    }, "Registration successful", 201);
}));

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

    // Use a generic message for all auth failures — don't reveal whether username/password is wrong
    const INVALID_CREDENTIALS_MSG = "Invalid username or password";
    if (!user) return error(res, INVALID_CREDENTIALS_MSG, 401, "INVALID_CREDENTIALS");
    if (!user.isActive) return error(res, INVALID_CREDENTIALS_MSG, 401, "INVALID_CREDENTIALS");

    const match = await bcrypt.compare(password, user.password);
    if (!match) return error(res, INVALID_CREDENTIALS_MSG, 401, "INVALID_CREDENTIALS");

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

// PATCH /api/v1/auth/me — update own profile (fullName, email, phone)
router.patch("/me", authenticate, asyncHandler(async (req, res) => {
    const { fullName, email, phone } = req.body;
    const user = await User.findByPk(req.user.id);
    if (!user) return error(res, "User not found", 404);

    if (fullName !== undefined) user.fullName = String(fullName).trim();
    if (email    !== undefined) user.email    = String(email).trim().toLowerCase() || null;
    if (phone    !== undefined) user.phone    = String(phone).trim() || null;

    await user.save();

    await AuditLog.create({
        userId: user.id,
        action: "PROFILE_UPDATED",
        description: "User updated own profile",
        ipAddress: req.ip
    });

    return success(res, {
        id:       user.id,
        username: user.username,
        fullName: user.fullName,
        email:    user.email,
        phone:    user.phone,
    }, "Profile updated");
}));

// PATCH /api/v1/auth/change-password
router.patch("/change-password", authenticate, validate(changePasswordSchema), asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findByPk(req.user.id);

    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return error(res, "Current password is wrong", 400, "WRONG_PASSWORD");

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // Revoke all OTHER sessions — the current session stays valid
    await destroyAllUserSessions(user.id, req.token);

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
