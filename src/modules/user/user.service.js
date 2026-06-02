const db = require('../../config/db');
const CoreLogic = require('../core/core.logic');
const { registerUser } = require('../core/referral.engine');

module.exports = {
  getAllUsers: CoreLogic.getAllUsers,
  createUser: CoreLogic.createUser,
  registerUser,
};