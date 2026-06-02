const db = require('../../config/db');

async function updateBalance(userId, amount, type) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [userRows] = await conn.execute('SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId]);
    const currentBalance = Number(userRows?.[0]?.balance || 0);
    const query = type === 'DEPOSIT'
      ? 'UPDATE wallets SET balance = balance + ? WHERE user_id = ?'
      : 'UPDATE wallets SET balance = balance - ? WHERE user_id = ?';

    await conn.execute(query, [amount, userId]);
    const nextBalance = Number((type === 'DEPOSIT' ? currentBalance + Number(amount || 0) : currentBalance - Number(amount || 0)).toFixed(2));
    await conn.execute('UPDATE users SET balance = ? WHERE id = ?', [nextBalance, userId]);
    await conn.execute('INSERT INTO transaction_ledger (user_id, amount, type) VALUES (?, ?, ?)', [userId, amount, type]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
}
module.exports = { updateBalance };
