const express = require('express');
const router = express.Router();
const adminCtrl = require('../modules/admin/controllers/adminController');
const authController = require('./../modules/admin/controllers/adminController');
const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const auth = require('../modules/middlewares/middlewares/authMiddleware');
const master = require('../controllers/masterController');
const { Match } = require('../models');


// *****
const sequelize = require("../config/db");

const Wallet = require("../modules/wallet/wallet.model");
const User = require("../modules/user/user.model");

const { getRiskData } = require("../core/risk.engine");
const { generateUserReport } = require("../core/report.engine");

const { verifyToken, allowRoles } = require("../middleware/auth.middleware");
const { logAction } = require("../utils/auditLogger");



router.post('/change-password', auth(), adminCtrl.changePassword);
router.post('/deposit-chips', auth(), adminCtrl.depositChips);
router.get('/search-users', auth(), adminCtrl.searchUsers);
router.get('/deleted-users', auth(), adminCtrl.deletedUsers);
router.get('/inactive-users', auth(), adminCtrl.inactiveUsers);
router.get('/users/bet-locked', auth(), adminCtrl.betLockedUsers);




router.post('/login', authController.login);

router.post('/action/change-password', adminCtrl.changePassword);
router.post('/user/change-password', adminCtrl.changePassword);


router.post('/action/deposit', adminCtrl.depositBalance);
router.post('/action/block-market', adminCtrl.toggleMarket);
router.get('/downline', auth(), adminCtrl.getMyDownline); // ডাউনলাইন ডাটা টানার জন্য



router.post('/user-action', master.handleUserAction);
router.post('/system-update', master.updateSystemSettings);
router.post('/match-control', master.handleMatchAction);
router.post('/master/create-user', master.createUser);

// router.get('/downline', master.handleUserAction); // Search/List এর জন্য


// /api/admin / downline(GET) - ডাউনলাইন লিস্টের জন্য।
// /api/admin / action / deposit(POST) - চিপস দেওয়ার জন্য।
// /api/admin / user / change - password(POST) - পাসওয়ার্ড পরিবর্তনের জন্য।
// /api/admin / master / create - user(POST) - নতুন মাদার প্যানেল তৈরির জন্য।



router.patch("/match/:id/block", auth("OWNER"), async (req, res) => {
    const match = await Match.findByPk(req.params.id);
    match.status = "BLOCKED";
    await match.save();
    res.json({ message: "Match blocked" });
});

// মাস্টার অ্যাকশন এপিআই (সব ২৬টি অপশনের জন্য)
router.post('/action', auth(), async (req, res) => {
    const { action, targetId, value, role } = req.body;
    try {
        switch (action) {
            case 'DEPOSIT':
                await pool.execute("UPDATE users SET balance = balance + ? WHERE id = ?", [value, targetId]);
                return res.json({ success: true, message: "চিপস জমা হয়েছে!" });

            case 'PASSWORD':
                const hash = await bcrypt.hash(value, 10);
                await pool.execute("UPDATE users SET password = ? WHERE id = ?", [hash, targetId]);
                return res.json({ success: true, message: "পাসওয়ার্ড আপডেট হয়েছে!" });

            case 'ADD_USER': // Mother Panel বা অন্য কিছু তৈরি
                const pash = await bcrypt.hash('123456', 10); // ডিফল্ট পাসওয়ার্ড
                await pool.execute("INSERT INTO users (username, role, password, parent_id) VALUES (?, ?, ?, ?)", [value, role, pash, req.user.id]);
                return res.json({ success: true, message: `${role} তৈরি হয়েছে!` });

            case 'BLOCK_MARKET':
                await pool.execute("UPDATE matches SET is_active = ? WHERE id = ?", [value, targetId]);
                return res.json({ success: true, message: "মার্কেট আপডেট হয়েছে!" });

            default:
                return res.status(400).json({ success: false, message: "অ্যাকশন নট ফাউন্ড!" });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});




router.post('/setup-owner', async (req, res) => {
    try {
        const username = "owner"; // ওনার ইউজারনেম
        const password = "owner_password123"; // ওনার পাসওয়ার্ড

        // পাসওয়ার্ড হ্যাশ করে ডাটাবেসে সেভ করা (Security)
        const hashedPassword = await bcrypt.hash(password, 10);

        // await pool.query(
        //     'INSERT INTO users (username, password, role, roleId) VALUES (?, ?, ?, ?)',
        //     [username, hashedPassword, 'OWNER', 1]
        // );
        await User.create({
            username,
            password: hashedPassword,
            role: "OWNER",
            roleId: 1
        });

        res.json({ success: true, message: "ওনার অ্যাকাউন্ট তৈরি হয়েছে বস!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});



// ******************************************************************* 


/* ================= DOWNLINE ================= */

// router.get("/downline", verifyToken, allowRoles("ADMIN", "OWNER"), async (req, res) => {
//     console.log({ name: "rokeya" });

//     const users = await User.findAll({
//         attributes: ["id", "username", "role", "balance"]
//     });

//     console.log({ users });

//     return res.json({ users });
// });


/* ================= DEPOSIT ================= */

router.post("/deposit", async (req, res) => {

    const t = await sequelize.transaction();

    try {

        const { userId, amount } = req.body;

        const wallet = await Wallet.findOne({ where: { userId } });

        wallet.balance += Number(amount);

        await wallet.save({ transaction: t });

        await t.commit();
        await logAction(req.user.id, "Deposit Done", req.ip);

        res.json({ success: true });

    } catch (err) {

        await t.rollback();
        res.status(500).json({ error: "Deposit Failed" });

    }
});


/* ================= RISK ================= */

router.get("/risk", async (req, res) => {

    const data = await getRiskData();

    res.json(data);
});


/* ================= REPORT ================= */

router.get("/report/:userId", async (req, res) => {

    const data = await generateUserReport(req.params.userId);

    res.json(data);
});


/* ================= MESSAGE ================= */

router.post("/message", async (req, res) => {

    const { type, message } = req.body;

    console.log("Admin Message:", type, message);

    res.json({ success: true });
});



module.exports = router;
