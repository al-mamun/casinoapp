const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Session = sequelize.define("Session", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    tokenHash: { type: DataTypes.STRING, allowNull: false },
    ipAddress: { type: DataTypes.STRING, allowNull: true },
    userAgent: { type: DataTypes.STRING, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    lastActivityAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
    tableName: "sessions",
    timestamps: true
});

module.exports = Session;
