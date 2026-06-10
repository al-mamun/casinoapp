require('dotenv').config();

if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        console.error('[FATAL] JWT_SECRET environment variable is not set. Refusing to start in production without a secure secret.');
        process.exit(1);
    } else {
        console.warn('[SECURITY WARNING] JWT_SECRET is not set. A random secret is being generated — all sessions will be invalidated on restart. Set JWT_SECRET in your .env file.');
    }
}

const JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(64).toString('hex');

module.exports = {
    PORT: process.env.PORT || 3000,
    MONGODB_URI: process.env.MONGODB_URI || process.env.MONGO_URI,
    MONGODB_DB: process.env.MONGODB_DB || process.env.DB_NAME || 'betx365',
    JWT_SECRET
};
