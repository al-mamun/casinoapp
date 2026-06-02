require('dotenv').config();
module.exports = {
  MONGODB_URI: process.env.MONGODB_URI || process.env.MONGO_URI,
  MONGODB_DB: process.env.MONGODB_DB || process.env.DB_NAME || 'betx365',
  DB_DIALECT: process.env.DB_DIALECT || 'mongodb',
  PORT: process.env.PORT || 3000,
};
