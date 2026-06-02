exports.blockMatch = async (req, res) => {
    const match = await Match.findByPk(req.params.id);
    match.status = "BLOCKED";
    await match.save();

    res.json({ message: "Match blocked successfully" });
};