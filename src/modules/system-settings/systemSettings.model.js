const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const SystemSettings = sequelize.define("SystemSettings", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    key: { type: DataTypes.STRING, allowNull: false, unique: true },
    value: { type: DataTypes.TEXT, allowNull: true }, // JSON stringified
    category: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'general'
    },
    description: { type: DataTypes.STRING, allowNull: true },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true }
}, {
    tableName: "system_settings",
    timestamps: true
});

module.exports = SystemSettings;
