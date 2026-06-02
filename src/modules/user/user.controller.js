const express = require('express');
const router = express.Router();
const userService = require('./user.service');
const pool = require('../../config/db');
const bcrypt = require('bcryptjs');

// Get all users
router.get('/', async (req, res) => {
    try {
        const users = await userService.getAllUsers();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



exports.addSubUser = async (req, res) => {
    try {
        const { username, password, role_to_create } = req.body;
        const creatorId = req.user.id; // যে এড করছে (যেমন ওনার বা মাদার প্যানেল)
        const creatorName = req.user.username;

        // পাসওয়ার্ড এনক্রিপ্ট করা
        const hashedPassword = await bcrypt.hash(password, 10);

        // ডাটাবেসে নিচের মেম্বার এড করা
        const [result] = await pool.execute(
            'INSERT INTO users (username, password, role, parent_id, created_by_name) VALUES (?, ?, ?, ?, ?)',
            [username, hashedPassword, role_to_create, creatorId, creatorName]
        );

        res.json({
            success: true,
            message: `${role_to_create} সফলভাবে তৈরি হয়েছে! এটি তৈরি করেছেন: ${creatorName}`
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "ইউজার তৈরি করা সম্ভব হয়নি বা নাম আগে থেকেই আছে।" });
    }
};

module.exports = router;
