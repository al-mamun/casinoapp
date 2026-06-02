// const { DataTypes } = require("sequelize");
// const sequelize = require("../../config/sequelize.db");

// const League = sequelize.define("League", {
//     id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
//     sportId: { type: DataTypes.INTEGER, allowNull: false },
//     name: { type: DataTypes.STRING, allowNull: false },
//     country: { type: DataTypes.STRING },
//     status: { type: DataTypes.BOOLEAN, defaultValue: true }
// });

// module.exports = League;

const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const League = sequelize.define("League", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    sportId: { type: DataTypes.INTEGER, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    country: { type: DataTypes.STRING },
    status: { type: DataTypes.BOOLEAN, defaultValue: true }
});

module.exports = League;