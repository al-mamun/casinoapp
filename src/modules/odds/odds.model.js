const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Odds = sequelize.define("Odds", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    marketId: { type: DataTypes.INTEGER },
    selection: DataTypes.STRING,
    value: DataTypes.FLOAT
});

module.exports = Odds;