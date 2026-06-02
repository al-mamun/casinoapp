const { canCreate } = require('./role.engine');
const db = require('../../config/db');

module.exports = {
  canCreateUser: canCreate,
  calculateDepositBonus: (amount, pct, to) => ({ bonus: (amount * pct) / 100, required: amount * to }),
  referralCommission: (loss, pct) => (loss * pct) / 100,
};

async function getMyAgentInfo(playerId) {
    const [info] = await db.execute(`
        SELECT u.whatsapp_num, u.payment_methods 
        FROM users u 
        JOIN users p ON u.id = p.parent_id 
        WHERE p.id = ?`, [playerId]);
        
    return info[0]; // এটি প্লেয়ারকে শো করবে
}

async function registerUser(username, password, refCode) {
    // ১. রেফার কোড চেক করা (এটি বাধ্যতামূলক)
    const [agent] = await db.execute('SELECT id FROM users WHERE username = ? AND role = "MASTER_AGENT"', [refCode]);
    
    if (!agent.length) {
        throw new Error('ভ্যালিড মাস্টার এজেন্ট রেফার কোড ছাড়া একাউন্ট করা সম্ভব নয়!');
    }

    // ২. ইউজার ক্রিয়েট করা এবং parent_id হিসেবে এজেন্টের ID বসানো
    const hashedPassword = await bcrypt.hash(password, 10);
    const [newUser] = await db.execute(
        'INSERT INTO users (username, password, role, parent_id) VALUES (?, ?, "PLAYER", ?)',
        [username, hashedPassword, agent[0].id]
    );

    return { success: true, message: 'একাউন্ট তৈরি হয়েছে!' };
}

module.exports.registerUser = registerUser;
module.exports.getMyAgentInfo = getMyAgentInfo;