const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");
const User = require("../modules/user/user.model");
const { Wallet, Match, Transaction } = require("../models");
const { checkPermission } = require("../middleware/permission.middleware");

router.get("/", verifyToken, allowRoles("OWNER", "ADMIN", "MASTER", "AGENT"),
    checkPermission("DOWNLINE", "VIEW"), async (req, res) => {

        const users = await User.findAll({
            where: { parentId: req.user.id, isDeleted: false }
        });

        res.json(users);
    });

// Deposite Chips
// router.post("/deposit",
//     verifyToken,
//     allowRoles("OWNER", "ADMIN", "MASTER"),
//     async (req, res) => {

//         const { userId, amount } = req.body;

//         const wallet = await Wallet.findOne({ where: { userId } });
//         wallet.balance += Number(amount);
//         await wallet.save();

//         res.json({ success: true });
//     });

router.post("/deposit", async (req, res) => {

    const { userId, amount } = req.body;

    const wallet = await Wallet.findOne({ where: { userId } });
    wallet.balance += Number(amount);
    await wallet.save();

    await Transaction.create({
        userId,
        type: "deposit",
        amount,
        status: "approved"
    });

    res.json({ success: true });
});
router.post("/withdraw", async (req, res) => {

    const { amount } = req.body;

    const wallet = await Wallet.findOne({ where: { userId: req.user.id } });

    if (wallet.balance < amount)
        return res.status(400).json({ error: "Insufficient balance" });

    wallet.balance -= amount;
    await wallet.save();

    await Transaction.create({
        userId: req.user.id,
        type: "withdraw",
        amount,
        status: "pending"
    });

    res.json({ success: true });
});


// Search users by username
router.get("/search/:username",
    verifyToken,
    allowRoles("OWNER", "ADMIN", "MASTER"),
    async (req, res) => {

        const user = await User.findOne({
            where: { username: req.params.username }
        });

        res.json(user);
    });


// Get all active matches
router.get("/active", verifyToken, async (req, res) => {
    const matches = await Match.findAll({ where: { status: "ACTIVE" } });
    res.json(matches);
});


// Block the match market
router.post("/block",
    verifyToken,
    allowRoles("OWNER", "ADMIN"),
    async (req, res) => {

        const match = await Match.findByPk(req.body.matchId);
        match.status = "BLOCKED";
        await match.save();

        res.json({ success: true });
    });


// Bet Lock
router.post("/bet-lock",
    verifyToken,
    allowRoles("OWNER", "ADMIN"),
    async (req, res) => {

        const user = await User.findByPk(req.body.userId);
        user.isBetLocked = true;
        await user.save();

        res.json({ success: true });
    });


/*
STEP 8: INACTIVE USER
Js

user.isActive = false;



STEP 9: SOFT DELETE USER
Js

user.isDeleted = true;

*/



module.exports = router;