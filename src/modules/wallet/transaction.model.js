const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Transaction = sequelize.define("Transaction", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: DataTypes.INTEGER,
    type: DataTypes.STRING,
    amount: DataTypes.FLOAT,
    note: DataTypes.STRING
});

module.exports = Transaction;