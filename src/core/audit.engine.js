const { DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize.db");

const AuditLog = sequelize.define("AuditLog", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: true },
    action: { type: DataTypes.STRING, allowNull: false },
    entity: { type: DataTypes.STRING, allowNull: true },
    entityId: { type: DataTypes.INTEGER, allowNull: true },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    ipAddress: { type: DataTypes.STRING, allowNull: true },
    userAgent: { type: DataTypes.STRING, allowNull: true },
    metadata: { type: DataTypes.TEXT, allowNull: true } // JSON string
}, {
    tableName: "audit_logs",
    timestamps: true
});

module.exports = AuditLog;
