const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Notification = sequelize.define("Notification", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: true },
    type: {
        type: DataTypes.ENUM('INFO', 'SUCCESS', 'WARNING', 'ERROR', 'DEPOSIT', 'WITHDRAW', 'BET', 'SYSTEM'),
        defaultValue: 'INFO'
    },
    isRead: { type: DataTypes.BOOLEAN, defaultValue: false },
    link: { type: DataTypes.STRING, allowNull: true }
}, {
    tableName: "notifications",
    timestamps: true
});

module.exports = Notification;
