const db = require('../../config/db');
const { canCreate } = require('./role.engine');

async function getAllUsers() {
  let conn;
  try {
    conn = await db.getConnection();
    const rows = await conn.query('SELECT * FROM users');
    return rows;
  } catch (error) {
    throw new Error(`Failed to fetch users: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
}

async function createUser(creatorRole, targetRole, data) {
  let conn;
  try {
    if (!canCreate(creatorRole, targetRole)) {
      throw new Error('Permission denied: You cannot create this role');
    }
    conn = await db.getConnection();
    const res = await conn.execute(
      'INSERT INTO users (username, role, parent_id) VALUES (?, ?, ?)',
      [data.username, targetRole, data.parentId]
    );
    return res.insertId;
  } catch (error) {
    throw new Error(`Failed to create user: ${error.message}`);
  } finally {
    if (conn) conn.release();
  }
}

module.exports = { getAllUsers, createUser };