const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Match = sequelize.define("Match", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    leagueId: { type: DataTypes.INTEGER, allowNull: false },
    teamA: { type: DataTypes.STRING, allowNull: false },
    teamB: { type: DataTypes.STRING, allowNull: false },
    startTime: { type: DataTypes.DATE, allowNull: true },
    homeScore: { type: DataTypes.INTEGER, allowNull: true },
    awayScore: { type: DataTypes.INTEGER, allowNull: true },
    status: {
        type: DataTypes.ENUM("ACTIVE", "INACTIVE", "BLOCKED", "COMPLETED", "LIVE"),
        defaultValue: "ACTIVE"
    },
    isManual: { type: DataTypes.BOOLEAN, defaultValue: false },
    provider: { type: DataTypes.STRING, allowNull: true }
}, {
    tableName: "matches",
    timestamps: true
});

module.exports = Match;
