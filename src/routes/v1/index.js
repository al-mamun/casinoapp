const router = require("express").Router();

// Mount all v1 routes
router.use("/auth", require("./auth.routes"));
router.use("/users", require("./users.routes"));
router.use("/banking", require("./banking.routes"));
router.use("/bets", require("./bets.routes"));
router.use("/matches", require("./matches.routes"));
router.use("/results", require("./results.routes"));
router.use("/reports", require("./reports.routes"));
router.use("/settings", require("./settings.routes"));
router.use("/messages", require("./messages.routes"));
router.use("/website", require("./website.routes"));
router.use("/permissions", require("./permissions.routes"));
router.use("/surveillance", require("./surveillance.routes"));
router.use("/company-payment", require("./companyPayment.routes"));
router.use("/upload", require("./upload.routes"));
router.use("/player", require("./player.routes"));
router.use("/admin", require("./admin.dynamic.routes"));
router.use("/player-api", require("./player.dynamic.routes"));

module.exports = router;
