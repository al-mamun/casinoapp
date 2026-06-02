const Bet = require("./bets.model");
const Wallet = require("../wallet/wallet.model");

exports.settleMatch = async (matchId, winningOdds) => {

    const bets = await Bet.findAll({ where: { matchId } });

    for (let bet of bets) {

        if (bet.odds === winningOdds) {
            bet.status = "WON";

            const wallet = await Wallet.findOne({ where: { userId: bet.userId } });
            wallet.balance += bet.potentialWin;
            await wallet.save();

        } else {
            bet.status = "LOST";
        }

        await bet.save();
    }
};