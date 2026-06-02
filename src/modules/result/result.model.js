const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Result = sequelize.define("Result", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    matchId: { type: DataTypes.INTEGER, allowNull: false },
    marketId: { type: DataTypes.INTEGER, allowNull: true },
    winningSelection: { type: DataTypes.STRING, allowNull: false },
    homeScore: { type: DataTypes.INTEGER, allowNull: true },
    awayScore: { type: DataTypes.INTEGER, allowNull: true },
    declaredBy: { type: DataTypes.INTEGER, allowNull: false },
    status: {
        type: DataTypes.ENUM('DECLARED', 'SUSPENDED', 'ROLLED_BACK', 'CONFIRMED'),
        defaultValue: 'DECLARED'
    },
    declaredAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    suspendedReason: { type: DataTypes.STRING, allowNull: true },
    rolledBackBy: { type: DataTypes.INTEGER, allowNull: true },
    rolledBackAt: { type: DataTypes.DATE, allowNull: true }
}, {
    tableName: "results",
    timestamps: true
});

module.exports = Result;
