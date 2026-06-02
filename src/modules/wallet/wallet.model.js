const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Wallet = sequelize.define("Wallet", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true
    },
    balance: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.00
    },
    totalDeposit: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.00
    },
    totalWithdraw: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.00
    },
    bonusEarned: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.00
    },
    requiredTurnover: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.00
    },
    completedTurnover: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.00
    },
    firstDepositBonusApplied: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    frozenBalance: {
        type: DataTypes.DECIMAL(15, 2),
        defaultValue: 0.00
    }
}, {
    tableName: "wallets",
    timestamps: true,
    hooks: {
        afterSave: async (wallet, options) => {
            if (!wallet?.userId) return;
            const User = require("../user/user.model");
            const transaction = options?.transaction;
            await User.update(
                { balance: wallet.balance },
                { where: { id: wallet.userId }, transaction }
            );
        }
    }
});

module.exports = Wallet;
