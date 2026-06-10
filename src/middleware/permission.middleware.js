const { Role, Permission } = require("../models");

exports.checkPermission = (moduleName, actionName) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ success: false, message: "Authentication required", errorCode: "UNAUTHORIZED" });
            }

            // req.user from the MongoDB adapter is a plain object — it has no .reload().
            // Fetch the user fresh from the database instead.
            const { User } = require("../models");
            const user = await User.findByPk(req.user.id, {
                include: [{ model: Role, include: [Permission] }]
            });

            if (!user) {
                return res.status(401).json({ success: false, message: "User not found", errorCode: "UNAUTHORIZED" });
            }

            // OWNER / full-access bypass
            const disableRbac = String(process.env.DISABLE_RBAC || "false").toLowerCase() === "true";
            if (disableRbac || req.user.role === "OWNER") return next();

            const permissions = user?.Role?.Permissions || [];
            const allowed = permissions.some(p => p.module === moduleName && p.action === actionName);

            if (!allowed) {
                return res.status(403).json({ success: false, message: "Permission denied", errorCode: "PERMISSION_DENIED" });
            }

            next();
        } catch (err) {
            return res.status(500).json({ success: false, message: "Permission check failed", errorCode: "INTERNAL_ERROR" });
        }
    };
};