const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/auth.middleware");
const allowRoles = require("../middleware/role.middleware");
const bcrypt = require("bcryptjs")

const User = require("../modules/user/user.model");
const Wallet = require("../modules/wallet/wallet.model");
const Bet = require("../modules/bets/bets.model");
const Match = require("../modules/matches/matches.model");


// =============================
// DOWNLINE LIST
// =============================
router.get("/downline", verifyToken, allowRoles("OWNER", "ADMIN"), async (req, res) => {
    const users = await User.findAll({
        include: [{ model: Wallet }]
    });

    res.json({
        success: true,
        users: users.map(u => ({
            id: u.id,
            username: u.username,
            role: u.role,
            balance: u.Wallet ? u.Wallet.balance : 0,
            status: u.status
        }))
    });
});


// =============================
// CREATE USER (Mother / Agent)
// =============================
router.post("/create-user", verifyToken, allowRoles("OWNER"), async (req, res) => {

    const { username, password, role } = req.body;

    const newUser = await User.create({
        username,
        password,
        role,
        parentId: req.user.id,
        status: "active"
    });

    await Wallet.create({
        userId: newUser.id,
        balance: 0
    });

    res.json({ success: true, message: "User created" });
});


// =============================
// DEPOSIT CHIPS
// =============================
router.post("/deposit", verifyToken, allowRoles("OWNER", "ADMIN"), async (req, res) => {

    const { userId, amount } = req.body;

    const wallet = await Wallet.findOne({ where: { userId } });
    if (!wallet) return res.status(404).json({ success: false, message: "Wallet not found" });

    const newBalance = Number((Number(wallet.balance || 0) + Number(amount)).toFixed(2));
    try {
        const wc = await Wallet.collection();
        await wc.updateMany(
            { userId: { $in: [Number(userId), String(userId)] } },
            { $set: { balance: newBalance, updatedAt: new Date() } }
        );
    } catch {
        wallet.balance = newBalance;
        await wallet.save();
    }

    res.json({ success: true, message: "Balance updated" });
});


// =============================
// CHANGE PASSWORD
// =============================
router.post("/change-own-password", verifyToken, async (req, res) => {

    const { newPassword } = req.body;
    const hashedPass = await bcrypt.hash(newPassword, 10)

    const user = await User.findByPk(req.user.id);
    console.log(user);
    // user.password = hashedPass;
    // await user.save();

    res.json({ success: true, message: "Password changed" });
});


// =============================
// ACTIVE MATCH LIST
// =============================
router.get("/matches/active", verifyToken, async (req, res) => {

    const matches = await Match.findAll({ where: { status: "ACTIVE" } });

    res.json({ success: true, matches });
});


// =============================
// BLOCK MARKET
// =============================
router.post("/match/block", verifyToken, allowRoles("OWNER"), async (req, res) => {

    const { matchId } = req.body;

    const match = await Match.findByPk(matchId);
    match.status = "BLOCKED";
    await match.save();

    res.json({ success: true, message: "Market blocked" });
});


// =============================
// BET LIST
// =============================
router.get("/bets", verifyToken, allowRoles("OWNER", "ADMIN"), async (req, res) => {

    const bets = await Bet.findAll();

    res.json({ success: true, bets });
});


// =============================
// RISK MANAGEMENT
// =============================
router.get("/risk", verifyToken, allowRoles("OWNER"), async (req, res) => {

    const exposure = await Bet.sum("stake", { where: { status: "OPEN" } });

    res.json({
        success: true,
        totalExposure: exposure || 0
    });
});


// =============================
// DEPOSIT REQUEST
// =============================
router.get("/deposit-requests", verifyToken, async (req, res) => {
    res.json({ success: true, data: [] });
});


// =============================
// WITHDRAW REQUEST
// =============================
router.get("/withdraw-requests", verifyToken, async (req, res) => {
    res.json({ success: true, data: [] });
});


module.exports = router;
