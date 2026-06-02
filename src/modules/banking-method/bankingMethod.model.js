const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const BankingMethod = sequelize.define("BankingMethod", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    type: {
        type: DataTypes.ENUM('BKASH', 'NAGAD', 'ROCKET', 'CRYPTO', 'BANK'),
        allowNull: false
    },
    accountNumber: { type: DataTypes.STRING, allowNull: false },
    accountName: { type: DataTypes.STRING, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
    minAmount: { type: DataTypes.DECIMAL(15, 2), defaultValue: 100 },
    maxAmount: { type: DataTypes.DECIMAL(15, 2), defaultValue: 100000 }
}, {
    tableName: "banking_methods",
    timestamps: true
});

module.exports = BankingMethod;
