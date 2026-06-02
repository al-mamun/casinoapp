const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const Role = sequelize.define("Role", {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING, unique: true },
  level: { type: DataTypes.INTEGER }
}, {
  tableName: "roles"
});

module.exports = Role;