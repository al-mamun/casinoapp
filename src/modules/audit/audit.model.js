const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Audit = sequelize.define("Audit", {

    userId: DataTypes.INTEGER,
    action: DataTypes.STRING,
    ip: DataTypes.STRING
});

module.exports = Audit;