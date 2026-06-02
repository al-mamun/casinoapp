const express = require("express");
const router = express.Router();
const sequelize = require("../config/db");

const Wallet = require("../modules/wallet/wallet.model");
const User = require("../modules/user/user.model");

const { getRiskData } = require("../core/risk.engine");
const { generateUserReport } = require("../core/report.engine");

const { verifyToken, allowRoles } = require("../middleware/auth.middleware");
const { logAction } = require("../utils/auditLogger");

/* ================= DOWNLINE ================= */

router.get("/downline", verifyToken, allowRoles("ADMIN", "OWNER"), async (req, res) => {
    console.log({ name: "rokeya" });

    const users = await User.findAll({
        attributes: ["id", "username", "role", "balance"]
    });

    console.log({ users });

    return res.json({ users });
});


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