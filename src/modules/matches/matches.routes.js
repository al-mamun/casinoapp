const settlement = require("../../core/settlement.engine");
const router = require("express").Router();

router.post("/:id/settle", async (req, res) => {
    try {
        await settlement.settleMatch(req.params.id, req.body.winningOdds);
        res.json({ message: "Settlement completed" });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});
module.exports = router;