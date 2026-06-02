const { Role, Permission } = require("../models");

exports.checkPermission = (moduleName, actionName) => {

    return async (req, res, next) => {

        const user = await req.user.reload({
            include: {
                model: Role,
                include: Permission
            }
        });

        const allowed = user.Role.Permissions.some(p =>
            p.module === moduleName && p.action === actionName
        );

        if (!allowed) {
            return res.status(403).json({ error: "Access Denied" });
        }

        next();
    };
};