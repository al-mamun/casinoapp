const { DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize.db");

const AuditLog = sequelize.define("AuditLog", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: DataTypes.INTEGER,
    action: DataTypes.STRING,
    amount: DataTypes.FLOAT,
    description: DataTypes.STRING
}, {
    timestamps: true
});

module.exports = AuditLog;