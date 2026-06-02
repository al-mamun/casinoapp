const router = require("express").Router();
const leagues = require("../modules/leagues/leagues.routes");
const matches = require("../modules/matches/matches.routes");
const { getMatchReport, getAuditTrail } = require("../core/report.engine");
const User = require("../modules/user/user.model");


router.use("/leagues", leagues);
router.use("/matches", matches);


router.get("/report/:matchId", async (req, res) => {
    const report = await getMatchReport(req.params.matchId);
    res.json(report);
});

router.get("/audit/:userId", async (req, res) => {
    const logs = await getAuditTrail(req.params.userId);
    res.json(logs);
});


router.get("/dashboard", async (req, res) => {

    const totalUsers = await User.count();

    res.json({
        totalUsers
    });
});

module.exports = router;