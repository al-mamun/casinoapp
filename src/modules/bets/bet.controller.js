const { validateRisk } = require("../../core/risk.engine");
const { calculateMatchExposure } = require("../../core/exposure.engine");

exports.placeBet = async (req, res) => {

    const { userId, matchId, odds, stake, selection } = req.body;

    await validateRisk(userId, matchId, stake);

    const exposure = await calculateMatchExposure(matchId);

    const liability = stake * (odds - 1);

    if (exposure[selection] && exposure[selection] + liability > 100000) {
        return res.status(400).json({ message: "Match liability exceeded" });
    }

    // এরপর normal bet placement logic
};