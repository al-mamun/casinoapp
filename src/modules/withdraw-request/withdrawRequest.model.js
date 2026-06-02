const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const WithdrawRequest = sequelize.define("WithdrawRequest", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    methodId: { type: DataTypes.INTEGER, allowNull: true },
    methodName: { type: DataTypes.STRING, allowNull: true },
    accountNumber: { type: DataTypes.STRING, allowNull: true },
    status: {
        type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED', 'HOLD'),
        defaultValue: 'PENDING'
    },
    approvedBy: { type: DataTypes.INTEGER, allowNull: true },
    rejectedReason: { type: DataTypes.STRING, allowNull: true },
    processedAt: { type: DataTypes.DATE, allowNull: true }
}, {
    tableName: "withdraw_requests",
    timestamps: true
});

module.exports = WithdrawRequest;
