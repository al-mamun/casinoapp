const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Message = sequelize.define("Message", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    type: {
        type: DataTypes.ENUM('USER', 'HYPER', 'IMPORTANT', 'IMAGE'),
        allowNull: false
    },
    title: { type: DataTypes.STRING, allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: true },
    imageUrl: { type: DataTypes.STRING, allowNull: true },
    targetUserId: { type: DataTypes.INTEGER, allowNull: true },
    createdBy: { type: DataTypes.INTEGER, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true }
}, {
    tableName: "messages",
    timestamps: true
});

module.exports = Message;
