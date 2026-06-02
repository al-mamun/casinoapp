const router = require("express").Router();
const { placeBet } = require("./bets.controller");

router.post("/place", placeBet);

module.exports = router;
