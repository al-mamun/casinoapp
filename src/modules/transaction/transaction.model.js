const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Transaction = sequelize.define("Transaction", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    type: {
        type: DataTypes.ENUM('DEPOSIT', 'WITHDRAW', 'BET_PLACED', 'BET_WON', 'BET_LOST', 'COMMISSION', 'TRANSFER_IN', 'TRANSFER_OUT', 'REFUND', 'GAME_SETTLEMENT'),
        allowNull: false
    },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    balanceBefore: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    balanceAfter: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    status: {
        type: DataTypes.ENUM('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'),
        defaultValue: 'COMPLETED'
    },
    fromId: { type: DataTypes.INTEGER, allowNull: true },
    toId: { type: DataTypes.INTEGER, allowNull: true },
    description: { type: DataTypes.STRING, allowNull: true },
    referenceId: { type: DataTypes.STRING, allowNull: true },
    referenceType: { type: DataTypes.STRING, allowNull: true }
}, {
    tableName: "transactions",
    timestamps: true
});

module.exports = Transaction;
