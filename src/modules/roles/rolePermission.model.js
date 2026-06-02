const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const RolePermission = sequelize.define("RolePermission", {
    roleId: DataTypes.INTEGER,
    permissionId: DataTypes.INTEGER
}, {
    tableName: "role_permissions"
});

module.exports = RolePermission;