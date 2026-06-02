const express = require("express");
const router = express.Router();
const User = require("../user/user.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user) return res.json({ success: false, message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ success: false, message: "Wrong password" });

    const token = jwt.sign(
      { id: user.id, roleId: user.roleId },
      "SECRET",
      { expiresIn: "1d" }
    );

    res.json({ success: true, token });
  } catch (err) {
    res.json({ success: false, message: "Login error" });
  }
});

module.exports = router;
