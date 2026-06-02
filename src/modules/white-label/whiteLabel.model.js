const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const WhiteLabel = sequelize.define("WhiteLabel", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    domain: { type: DataTypes.STRING, allowNull: true, unique: true },
    ownerId: { type: DataTypes.INTEGER, allowNull: false },
    logoUrl: { type: DataTypes.STRING, allowNull: true },
    themeConfig: { type: DataTypes.TEXT, allowNull: true }, // JSON string
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
    maxUsers: { type: DataTypes.INTEGER, defaultValue: 1000 },
    siteName: { type: DataTypes.STRING, allowNull: true },
    noticeText: { type: DataTypes.TEXT, allowNull: true },
    maintenanceMode: { type: DataTypes.BOOLEAN, defaultValue: false }
}, {
    tableName: "white_labels",
    timestamps: true
});

module.exports = WhiteLabel;
