const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const PlayerStats = sequelize.define("PlayerStats", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    totalBets: { type: DataTypes.INTEGER, defaultValue: 0 },
    totalWon: { type: DataTypes.INTEGER, defaultValue: 0 },
    totalLost: { type: DataTypes.INTEGER, defaultValue: 0 },
    totalStake: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    totalPayout: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    totalCommission: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
    winRate: { type: DataTypes.FLOAT, defaultValue: 0 },
    lastBetAt: { type: DataTypes.DATE, allowNull: true }
}, {
    tableName: "player_stats",
    timestamps: true
});

module.exports = PlayerStats;
