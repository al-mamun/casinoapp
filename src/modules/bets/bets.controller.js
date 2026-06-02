// const Bet = require("./bets.model");
// const Wallet = require("../wallet/wallet.model");

// exports.placeBet = async (req, res) => {
//     const { userId, matchId, marketId, odds, stake } = req.body;

//     const wallet = await Wallet.findOne({ where: { userId } });

//     if (wallet.balance < stake)
//         return res.status(400).json({ message: "Insufficient balance" });

//     wallet.balance -= stake;
//     await wallet.save();

//     const bet = await Bet.create({
//         userId,
//         matchId,
//         marketId,
//         odds,
//         stake,
//         potentialWin: stake * odds
//     });

//     res.json(bet);
// };


// const Bet = require("./bets.model");
// const Wallet = require("../wallet/wallet.model");
// const Match = require("../matches/matches.model");
// const Odds = require("../markets/odds.model");
// const Transaction = require("../wallet/transaction.model");


// exports.placeBet = async (req, res) => {
//     try {
//         const { userId, matchId, marketId, oddsId, stake } = req.body;

//         const match = await Match.findByPk(matchId);
//         if (!match || match.status !== "ACTIVE") {
//             return res.status(400).json({ message: "Match not active" });
//         }

//         const oddsData = await Odds.findByPk(oddsId);
//         if (!oddsData) {
//             return res.status(400).json({ message: "Invalid odds" });
//         }

//         const wallet = await Wallet.findOne({ where: { userId } });
//         if (!wallet || wallet.balance < stake) {
//             return res.status(400).json({ message: "Insufficient balance" });
//         }

//         wallet.balance -= stake;

//         await Transaction.create({
//             userId,
//             type: "BET",
//             amount: stake,
//             note: "Bet placed"
//         });
//         await wallet.save();

//         const bet = await Bet.create({
//             userId,
//             matchId,
//             marketId,
//             odds: oddsData.value,
//             stake,
//             potentialWin: stake * oddsData.value
//         });

//         res.json(bet);

//     } catch (err) {
//         res.status(500).json({ message: "Bet failed", error: err.message });
//     }
// };



const sequelize = require("../../config/sequelize.db");
const Bet = require("./bets.model");
const Wallet = require("../wallet/wallet.model");
const Match = require("../matches/matches.model");
const Odds = require("../markets/odds.model");
const AuditLog = require("../../core/audit.engine");

exports.placeBet = async (req, res) => {

    const t = await sequelize.transaction();

    try {

        const { userId, matchId, oddsId, stake } = req.body;

        const match = await Match.findByPk(matchId);
        if (!match || match.status !== "ACTIVE")
            throw new Error("Match not active");

        const oddsData = await Odds.findByPk(oddsId);
        if (!oddsData)
            throw new Error("Invalid odds");

        const wallet = await Wallet.findOne({ where: { userId } });

        if (!wallet || wallet.balance < stake)
            throw new Error("Insufficient balance");

        wallet.balance -= stake;
        await wallet.save({ transaction: t });

        const bet = await Bet.create({
            userId,
            matchId,
            marketId: oddsData.marketId,
            odds: oddsData.value,
            stake,
            potentialWin: stake * oddsData.value
        }, { transaction: t });

        await AuditLog.create({
            userId,
            action: "BET_PLACED",
            amount: stake,
            description: `Bet placed on match ${matchId}`
        }, { transaction: t });

        await t.commit();
        res.json(bet);

    } catch (err) {
        await t.rollback();
        res.status(400).json({ message: err.message });
    }
};