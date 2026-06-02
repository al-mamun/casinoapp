const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Commission = sequelize.define("Commission", {

    roleId: DataTypes.INTEGER,
    type: DataTypes.STRING, // deposit, turnover, loss
    percentage: DataTypes.FLOAT

}, { tableName: "commissions" });

module.exports = Commission;