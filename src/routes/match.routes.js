const express = require("express");
const router = express.Router();

router.get("/", async (req, res) => {

    res.json({
        matches: [
            { name: "India vs Australia", status: "LIVE" },
            { name: "Bangladesh vs Pakistan", status: "UPCOMING" }
        ]
    });
});

module.exports = router;