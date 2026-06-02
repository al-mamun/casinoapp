const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Market = sequelize.define("Market", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    matchId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    type: {
        type: DataTypes.ENUM('WINNER', 'OVER_UNDER', 'HANDICAP', 'FANCY'),
        defaultValue: 'WINNER'
    },
    status: { type: DataTypes.BOOLEAN, defaultValue: true },
    isSuspended: { type: DataTypes.BOOLEAN, defaultValue: false },
    odds: { type: DataTypes.TEXT, allowNull: true } // JSON string for odds data
}, {
    tableName: "markets",
    timestamps: true
});

module.exports = Market;
