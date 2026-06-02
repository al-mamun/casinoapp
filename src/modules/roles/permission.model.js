const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Permission = sequelize.define("Permission", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    module: { type: DataTypes.STRING },
    action: { type: DataTypes.STRING }
}, {
    tableName: "permissions"
});

module.exports = Permission;