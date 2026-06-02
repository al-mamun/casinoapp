const Audit = require("../modules/audit/audit.model");

exports.logAction = async (userId, action, ip) => {

    await Audit.create({
        userId,
        action,
        ip
    });
};