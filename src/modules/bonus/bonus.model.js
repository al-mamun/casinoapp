const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Bonus = sequelize.define("Bonus", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    type: {
        type: DataTypes.ENUM('DEPOSIT', 'SIGNUP', 'REFERRAL', 'PROMO'),
        allowNull: false
    },
    amount: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    percentage: { type: DataTypes.FLOAT, defaultValue: 0 },
    maxBonus: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    minDeposit: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    maxUses: { type: DataTypes.INTEGER, defaultValue: 100 },
    usedCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true }
}, {
    tableName: "bonuses",
    timestamps: true
});

module.exports = Bonus;
