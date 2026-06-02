const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../../../config/index');

const auth = (...roles) => {
    return (req, res, next) => {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        console.log({ token });
        if (!token) {
            return res.status(401).json({ success: false, message: "Access denied. No token provided." });
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            console.log({ decoded });
            next();
        } catch (err) {
            res.status(401).json({ success: false, message: "Invalid token." });
        }
    }
};

module.exports = auth;