const router = require("express").Router();
const controller = require("./leagues.controller");
const auth = require("../../modules/middlewares/middlewares/authMiddleware");

router.post("/", auth("OWNER"), controller.createLeague);
router.get("/", auth(), controller.getAllLeagues);
router.patch("/:id/status", auth("OWNER"), controller.toggleLeague);

module.exports = router;