const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const BlockedIP = sequelize.define("BlockedIP", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    ipAddress: { type: DataTypes.STRING, allowNull: false },
    reason: { type: DataTypes.STRING, allowNull: true },
    blockedBy: { type: DataTypes.INTEGER, allowNull: true },
    isPermanent: { type: DataTypes.BOOLEAN, defaultValue: false },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
}, {
    tableName: "blocked_ips",
    timestamps: true
});

module.exports = BlockedIP;
