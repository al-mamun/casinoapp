const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../config/db');

const { JWT_SECRET } = require('../../config/index');

class AuthService {
  // পাসওয়ার্ড এনক্রিপ্ট করা (ইউজার ক্রিয়েট করার সময় এটি কল করবেন)
  async hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
  }

  // লগইন ভেরিফিকেশন এবং JWT জেনারেশন
  async verifyLogin(username, password) {
    // ডাটাবেস থেকে ইউজার চেক
    const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) throw new Error('ইউজার পাওয়া যায়নি!');

    const user = rows[0];

    // পাসওয়ার্ড ম্যাচিং
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new Error('ভুল পাসওয়ার্ড!');

    // JWT টোকেন তৈরি (১২ রোলের জন্যই প্রযোজ্য)
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    return { token, role: user.role };
  }
}

module.exports = new AuthService();
