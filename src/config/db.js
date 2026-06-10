/**
 * db.js — thin wrapper around the MongoDB adapter.
 *
 * All application code should use the Sequelize-style models (from src/models/index.js)
 * directly. This module exists only for legacy compatibility and health-check purposes.
 *
 * Do NOT call db.getConnection() or db.execute() — those are MySQL patterns that do
 * not apply here. Use model methods (findOne, findAll, create, update, destroy, etc.)
 */
require("dotenv").config();

const mongo = require("./mongoSequelizeAdapter");

module.exports = {
    /** Verify the database connection is alive (used by /health endpoint). */
    async authenticate() {
        return mongo.authenticate();
    },

    /** Close the underlying MongoDB client (call on graceful shutdown). */
    async close() {
        return mongo.close();
    },

    /**
     * @deprecated Use models directly. Throws a clear error so callers are
     * easy to identify and fix rather than silently failing.
     */
    getConnection() {
        throw new Error(
            "[db.js] getConnection() is not supported. " +
            "Use Sequelize-style models from 'src/models/index.js' instead " +
            "(e.g. User.findOne(...), Wallet.create(...))."
        );
    },

    /**
     * @deprecated Use models directly.
     */
    execute() {
        throw new Error(
            "[db.js] execute() is not supported. " +
            "Use Sequelize-style models from 'src/models/index.js' instead."
        );
    },
};
