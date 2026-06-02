require("dotenv").config();

// Compatibility layer: existing routes/models still use Sequelize-style calls,
// while persistence is handled by MongoDB Atlas underneath.
module.exports = require("./mongoSequelizeAdapter");
