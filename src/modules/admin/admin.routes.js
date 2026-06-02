const router = require("express").Router();
const auth = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");
const bcrypt = require("bcryptjs");

const User = require("../user/user.model");
const Role = require("../roles/role.model");
const panelHierarchy = require("../../utils/panelHierarchy");

router.use(auth);

// ✅ Create User (Hierarchy logic – FINAL)
router.post("/create-user", async (req, res) => {
  try {
    const { username, password, roleToCreate } = req.body;
    const creator = await User.findByPk(req.user.id, { include: Role });
    const creatorRole = creator.Role.name;
    const allowedNext = panelHierarchy[creatorRole]?.next;

    if (Array.isArray(allowedNext)) {
      if (!allowedNext.includes(roleToCreate)) {
        return res.status(403).json({ message: "Not allowed role create" });
      }
    } else {
      if (allowedNext !== roleToCreate) {
        return res.status(403).json({ message: "Not allowed role create" });
      }
    }

    const roleRecord = await Role.findOne({ where: { name: roleToCreate } });
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      username,
      password: hashedPassword,
      roleId: roleRecord.id,
      parentId: creator.id
    });

    res.json({ success: true, user: newUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Change Password (bcrypt fix)
router.post("/change-password", async (req, res) => {
  const { userId, password } = req.body;
  const user = await User.findByPk(userId);
  const hashed = await bcrypt.hash(password, 10);
  user.password = hashed;
  await user.save();
  res.json({ success: true, message: "Password Changed" });
});

// ✅ Deposit Chips
router.post("/deposit", roleMiddleware([1,2]), async (req, res) => {
  const { userId, amount } = req.body;
  const user = await User.findByPk(userId);
  user.balance += Number(amount);
  await user.save();
  res.json({ success: true, message: "Balance Added" });
});

// ✅ Search User
router.get("/search", async (req, res) => {
  const { username } = req.query;
  const user = await User.findOne({ where: { username } });
  res.json({ success: true, user });
});

// ✅ Downline (hierarchy fixed)
router.get("/downline", async (req, res) => {
  const users = await User.findAll({
    where: { parentId: req.user.id },
    include: ["children"]
  });
  res.json({ success: true, users });
});

// ✅ Block User + Bet Lock
router.post("/block-user", roleMiddleware([1,2]), async (req, res) => {
  const user = await User.findByPk(req.body.userId);
  user.status = "blocked";
  await user.save();
  res.json({ success: true });
});

router.post("/bet-lock", roleMiddleware([1,2]), async (req, res) => {
  const user = await User.findByPk(req.body.userId);
  user.betLock = true;
  await user.save();
  res.json({ success: true });
});

// বাকি ১৭+২৬ ফাংশন (placeholder – UI connect এর জন্য)
router.post("/match/active", async (req, res) => { res.json({ success: true, message: "Match Activated" }); });
router.post("/match/inactive", async (req, res) => { res.json({ success: true }); });
router.get("/bet-list", async (req, res) => { res.json({ success: true, data: [] }); });
router.get("/bet-live", async (req, res) => { res.json({ success: true, data: [] }); });
router.get("/risk", async (req, res) => { res.json({ success: true, exposure: 0 }); });
router.get("/deposit-requests", async (req, res) => { res.json({ success: true, data: [] }); });
router.get("/withdraw-requests", async (req, res) => { res.json({ success: true, data: [] }); });
router.post("/message", async (req, res) => { res.json({ success: true }); });
router.post("/website", async (req, res) => { res.json({ success: true }); });
router.post("/result", async (req, res) => { res.json({ success: true }); });
router.post("/privileges", async (req, res) => { res.json({ success: true }); });

module.exports = router;
