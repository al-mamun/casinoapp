const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { logAction } = require('../utils/auditLogger');

async function readBalance(conn, userId) {
    const [rows] = await conn.execute('SELECT balance FROM users WHERE id = ? LIMIT 1', [userId]);
    return Number(rows?.[0]?.balance || 0);
}

async function syncBalance(conn, userId, balance) {
    const nextBalance = Number(Number(balance || 0).toFixed(2));
    await conn.execute('UPDATE users SET balance = ? WHERE id = ?', [nextBalance, userId]);
    await conn.execute(
        'INSERT INTO wallets (user_id, balance) VALUES (?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
        [userId, nextBalance]
    );
    return nextBalance;
}

exports.createUser = async (req, res) => {
    try {
        const { username, password, role_to_create, commission } = req.body;
        const creatorId = req.user.id;
        const creatorName = req.user.username;
        const hashedPassword = await bcrypt.hash(password, 10);

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [result] = await conn.execute(
                `INSERT INTO users (username, password, role, parent_id, created_by_name, commission_rate, balance)
                 VALUES (?, ?, ?, ?, ?, ?, 0)`,
                [username, hashedPassword, role_to_create, creatorId, creatorName, commission || 0]
            );
            if (result?.insertId) {
                await conn.execute(
                    'INSERT INTO wallets (user_id, balance) VALUES (?, 0) ON DUPLICATE KEY UPDATE balance = VALUES(balance)',
                    [result.insertId]
                );
            }
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        res.json({ success: true, message: `${role_to_create} সফলভাবে তৈরি হয়েছে!` });
    } catch (err) {
        res.status(500).json({ success: false, message: "ইউজার তৈরি হয়নি। নাম চেক করুন।" });
    }
};

exports.handleBalance = async (req, res) => {
    await logAction(req.user.id, "Deposit Done", req.ip);
    const { targetId, amount, type } = req.body;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const currentBalance = await readBalance(conn, targetId);
        const delta = Number(amount || 0);
        const nextBalance = type === 'add' ? currentBalance + delta : currentBalance - delta;
        await syncBalance(conn, targetId, nextBalance);
        await conn.commit();
        res.json({ success: true, message: "ব্যালেন্স আপডেট হয়েছে।", balance: Number(nextBalance.toFixed(2)) });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};

exports.userAction = async (req, res) => {
    const { targetId, action, value } = req.body;
    if (action === 'password') {
        const hash = await bcrypt.hash(value, 10);
        await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hash, targetId]);
    } else if (action === 'status') {
        await pool.execute('UPDATE users SET status = ? WHERE id = ?', [value, targetId]);
    }
    res.json({ success: true, message: "অ্যাকশন সফল!" });
};

exports.handleUserAction = async (req, res) => {
    const { action, targetId, value } = req.body;
    try {
        switch (action) {
            case 'CHANGE_PASSWORD': {
                const hash = await bcrypt.hash(value, 10);
                await pool.execute('UPDATE users SET password = ? WHERE id = ?', [hash, targetId]);
                return res.json({ success: true, message: "পাসওয়ার্ড আপডেট সফল!" });
            }
            case 'DEPOSIT_CHIPS': {
                await logAction(req.user.id, "Deposit Done", req.ip);
                const conn = await pool.getConnection();
                try {
                    await conn.beginTransaction();
                    const currentBalance = await readBalance(conn, targetId);
                    const nextBalance = Number((currentBalance + Number(value || 0)).toFixed(2));
                    await syncBalance(conn, targetId, nextBalance);
                    await conn.commit();
                    return res.json({ success: true, message: "ব্যালেন্স জমা হয়েছে।", balance: nextBalance });
                } catch (err) {
                    await conn.rollback();
                    throw err;
                } finally {
                    conn.release();
                }
            }
            case 'SEARCH_USER': {
                const [users] = await pool.execute('SELECT * FROM users WHERE username LIKE ?', [`%${value}%`]);
                return res.json({ success: true, data: users });
            }
            case 'UPDATE_STATUS': {
                await pool.execute('UPDATE users SET status = ? WHERE id = ?', [value, targetId]);
                return res.json({ success: true, message: "স্ট্যাটাস আপডেট হয়েছে।" });
            }
            default:
                return res.status(400).json({ success: false, message: "অ্যাকশন খুঁজে পাওয়া যায়নি।" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.updateSystemSettings = async (req, res) => {
    const { type, settings } = req.body;
    try {
        const jsonSettings = JSON.stringify(settings);
        await pool.execute('UPDATE system_settings SET config_data = ? WHERE setting_type = ?', [jsonSettings, type]);
        res.json({ success: true, message: "সিস্টেম আপডেট সফল!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

exports.handleMatchAction = async (req, res) => {
    const { matchId, action, value } = req.body;
    try {
        if (action === 'TOGGLE_MATCH') {
            await pool.execute('UPDATE matches SET is_active = ? WHERE id = ?', [value, matchId]);
        } else if (action === 'RESULT_SET') {
            await pool.execute('UPDATE matches SET status = "completed", result = ? WHERE id = ?', [value, matchId]);
        }
        res.json({ success: true, message: "ম্যাচ আপডেট সফল!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
