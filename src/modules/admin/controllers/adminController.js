const db = require('../../../config/db'); // আপনার ডাটাবেস কানেকশন
const pool = require('../../../config/db'); // আপনার ডাটাবেস ফাইল
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { logAction } = require('../../../utils/auditLogger');
const Bet = require('../../bets/bets.model');
const sequelize = require('../../../config/sequelize.db');
const Wallet = require('../../wallet/wallet.model');
const Transaction = require('../../transaction/transaction.model');
const { Op } = require("sequelize");
const User = require('../../user/user.model');

// ১. পাসওয়ার্ড পরিবর্তনের লজিক
exports.changePassword = async (req, res) => {
    const { userId, newPassword } = req.body;
    const hash = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE users SET password = ? WHERE id = ?', [hash, userId]);
    res.json({ success: true, message: "পাসওয়ার্ড আপডেট হয়েছে!" });
};

// successForS
// ২. চিপস বা ব্যালেন্স ডিপোজিট লজিক (সব রোলের জন্য)
exports.depositChips = async (req, res) => {
    const { targetUserId, amount } = req.body;
    // console.log({ data: req.body });
    const adminId = req.user?.id;
    // ট্রানজেকশন শুরু (যাতে ব্যালেন্স ভুল না হয়)
    const conn = await db.getConnection();
    try {
        // await conn.beginTransaction();
        // await logAction(req.user.id, "Deposit Done", req.ip);
        // await conn.execute('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', [amount, targetUserId]);
        // await conn.execute('INSERT INTO transactions (from_id, to_id, amount, type) VALUES (?, ?, ?, "DEPOSIT")', [adminId, targetUserId, amount]);
        // await conn.commit();
        const t = await sequelize.transaction();
        // 1️⃣ Wallet balance update
        const wallet = await Wallet.findOne({
            where: { userId: targetUserId },
            transaction: t,
            lock: t.LOCK.UPDATE
        });

        if (!wallet) {
            throw new Error("Wallet not found");
        }

        wallet.balance = parseFloat(wallet.balance) + parseFloat(amount);
        await wallet.save({ transaction: t });

        // 2️⃣ Transaction record insert
        await Transaction.create({
            userId: targetUserId,
            type: "deposit",
            amount: amount,
            status: "completed",
            fromId: adminId,
            toId: targetUserId
        }, { transaction: t });

        // 3️⃣ Commit
        await t.commit();

        res.json({ success: true, message: "চিপস সফলভাবে পাঠানো হয়েছে!" });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ success: false, error: err.message });
    } finally { conn.release(); }
};

// ৩. ইউজার সার্চ লজিক (Search Users)
// exports.searchUsers = async (req, res) => {
//     const { username } = req.query;
//     console.log({ username });
//     const [users] = await db.execute('SELECT id, username, role, balance FROM users JOIN wallets ON users.id = wallets.user_id WHERE username LIKE ?', [`%${username}%`]);
//     res.json({ success: true, data: users });
// };

// successForS
exports.searchUsers = async (req, res) => {
    try {
        const { username } = req.query;
        console.log({ username });

        const users = await User.findAll({
            where: {
                username: {
                    [Op.like]: `%${username}%`
                },
                isDeleted: false
            },
            include: [
                {
                    model: Wallet,
                    attributes: ["id", "balance"]
                }
            ],
            order: [["id", "ASC"]]
        });

        res.json({
            success: true,
            data: users
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Something went wrong"
        });
    }
};

// successForS
exports.deletedUsers = async (req, res) => {
    try {
        const users = await User.findAll({
            where: {
                isDeleted: true
            },
            include: [
                {
                    model: Wallet,
                    attributes: ["id", "balance"]
                }
            ],
            order: [["id", "ASC"]]
        });

        res.json({
            success: true,
            data: users
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Something went wrong"
        });
    }
};

// successForS
exports.inactiveUsers = async (req, res) => {
    try {
        const users = await User.findAll({
            where: {
                status: "inactive"
            },
            include: [
                {
                    model: Wallet,
                    attributes: ["id", "balance"]
                }
            ],
            order: [["id", "ASC"]]
        });

        res.json({
            success: true,
            data: users
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Something went wrong"
        });
    }
};

// successForS
exports.betLockedUsers = async (req, res) => {
    try {
        const users = await User.findAll({
            where: {
                isBetLocked: true
            },
            include: [
                {
                    model: Wallet,
                    attributes: ["id", "balance"]
                }
            ],
            order: [["id", "ASC"]]
        });

        res.json({
            success: true,
            data: users
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Something went wrong"
        });
    }
};

exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        // ১. ডাটাবেসে ইউজার আছে কি না চেক করা
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: "ইউজার পাওয়া যায়নি!" });
        }

        const user = users[0];

        // ২. পাসওয়ার্ড চেক করা (যদি পাসওয়ার্ড হ্যাশ করা থাকে)
        const isMatch = await bcrypt.compare(password, user.password);
        // যদি টেস্টের জন্য নরমাল পাসওয়ার্ড থাকে তবে: if(password !== user.password)

        if (!isMatch) {
            return res.status(401).json({ success: false, message: "ভুল পাসওয়ার্ড!" });
        }

        // ৩. টোকেন তৈরি করা (লগইন সেশন ধরে রাখার জন্য)
        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.json({
            success: true,
            token,
            role: user.role, // OWNER নাকি AGENT
            message: "লগইন সফল হয়েছে বস!"
        });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};


exports.createDownline = async (req, res) => {
    try {
        const { username, password, role_to_create, commission, roleId } = req.body;

        // ১. যে এড করছে (লগইন করা ইউজার) তার তথ্য নেওয়া
        const creatorId = req.user.id;
        const creatorName = req.user.username;
        const creatorRole = req.user.role;

        // ২. সিকিউরিটি চেক: ওনার ছাড়া কেউ ওনার বানাতে পারবে না, এজেন্ট প্লেয়ার বানাবে ইত্যাদি
        // (এখানে লজিক সেট করে দিতে পারেন)

        // ৩. পাসওয়ার্ড হ্যাশ করা
        const hashedPassword = await bcrypt.hash(password, 10);

        // ৪. ডাটাবেসে ইনসার্ট করা
        const [result] = await pool.execute(
            `INSERT INTO users (username, password, role, parent_id, roleId, created_by_name, commission_rate) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [username, hashedPassword, role_to_create, creatorId, creatorName, commission || 0]
        );

        res.json({
            success: true,
            message: `অভিনন্দন! ${creatorName} এর আন্ডারে নতুন ${role_to_create} তৈরি হয়েছে।`
        });

    } catch (err) {
        res.status(500).json({ success: false, error: "ইউজার তৈরি হয়নি। হয়তো ইউজারনেমটি আগে থেকেই আছে।" });
    }
};


// exports.getMyDownline = async (req, res) => {
//     const creatorId = req.user.id; // লগইন করা ইউজারের আইডি
//     try {
//         const [rows] = await pool.execute('SELECT id, username, role, balance FROM users WHERE parent_id = ?', [creatorId]);
//         res.json({ success: true, users: rows });
//     } catch (err) {
//         res.status(500).json({ success: false, error: err.message });
//     }
// };

exports.depositBalance = async (req, res) => {
    try {
        const { targetId, amount } = req.body;
        await pool.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, targetId]);
        await logAction(req.user.id, "Deposit Done", req.ip);
        res.json({ success: true, message: "চিপস সফলভাবে ডিপোজিট হয়েছে!" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ২. মার্কেট ব্লক বাটন (১৭ অপশনের একটি)
exports.toggleMarket = async (req, res) => {
    try {
        const { matchId, status } = req.body; // status: 0 for block, 1 for active
        await pool.execute('UPDATE matches SET is_active = ? WHERE id = ?', [status, matchId]);
        res.json({ success: true, message: "মার্কেট স্ট্যাটাস আপডেট হয়েছে।" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ৩. ডাউনলাইন লিস্ট (যাতে ডাটা দেখা যায়)
exports.getMyDownline = async (req, res) => {
    try {
        const creatorId = req.user.id;
        console.log({ creatorId });
        const [rows] = await pool.execute(
            'SELECT id, username, role, balance, status FROM users WHERE parent_id = ?',
            [creatorId]
        );
        res.json({ success: true, users: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// Delete cheat users (যদি কেউ চিটিং করে, তাদের ডিলিট করার জন্য)
exports.detectCheat = async (userId) => {
    const bets = await Bet.findAll({ where: { userId } });

    const totalStake = bets.reduce((sum, b) => sum + b.stake, 0);

    if (totalStake > 500000) {
        return "Suspicious High Volume";
    }

    return "Normal";
};

