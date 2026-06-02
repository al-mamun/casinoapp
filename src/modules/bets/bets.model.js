const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Bet = sequelize.define("Bet", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    matchId: { type: DataTypes.INTEGER, allowNull: false },
    marketId: { type: DataTypes.INTEGER, allowNull: true },
    selection: { type: DataTypes.STRING, allowNull: true },
    odds: { type: DataTypes.FLOAT, allowNull: false },
    stake: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    potentialWin: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    liability: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    status: {
        type: DataTypes.ENUM('PENDING', 'OPEN', 'WON', 'LOST', 'CANCELLED', 'REJECTED', 'SETTLED'),
        defaultValue: 'PENDING'
    },
    isCheat: { type: DataTypes.BOOLEAN, defaultValue: false },
    cheatReason: { type: DataTypes.STRING, allowNull: true },
    settledAt: { type: DataTypes.DATE, allowNull: true },
    settledBy: { type: DataTypes.INTEGER, allowNull: true }
}, {
    tableName: "bets",
    timestamps: true
});

module.exports = Bet;
