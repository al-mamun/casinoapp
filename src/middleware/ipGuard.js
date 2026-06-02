const blockedIPs = ["192.168.1.100"];

module.exports = (req, res, next) => {

    if (blockedIPs.includes(req.ip)) {
        return res.status(403).json({ error: "IP Blocked" });
    }

    next();
};