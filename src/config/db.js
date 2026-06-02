require("dotenv").config();

const mongo = require("./mongoSequelizeAdapter");

module.exports = {
  async getDb() {
    await mongo.authenticate();
    return mongo;
  },
  async authenticate() {
    return mongo.authenticate();
  },
  async close() {
    return mongo.close();
  }
};
