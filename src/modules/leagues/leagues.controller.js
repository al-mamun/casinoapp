const League = require("./leagues.model");

exports.createLeague = async (req, res) => {
    const league = await League.create(req.body);
    res.json(league);
};

exports.getAllLeagues = async (req, res) => {
    const leagues = await League.findAll();
    res.json(leagues);
};

exports.toggleLeague = async (req, res) => {
    const league = await League.findByPk(req.params.id);
    league.status = !league.status;
    await league.save();
    res.json({ message: "League status updated" });
};