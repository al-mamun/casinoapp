require('dotenv').config();
module.exports = {
    PORT: process.env.PORT || 3000,
    MONGODB_URI: process.env.MONGODB_URI || process.env.MONGO_URI,
    MONGODB_DB: process.env.MONGODB_DB || process.env.DB_NAME || 'betx365',
    JWT_SECRET: process.env.JWT_SECRET || 'SUPER_SECRET_KEY_123'
};
