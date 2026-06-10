const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, Wallet } = require('../../models');

const JWT_SECRET = process.env.JWT_SECRET || require('../../config/index').JWT_SECRET;

class AuthService {
    async hashPassword(password) {
        return bcrypt.hash(password, 10);
    }

    async verifyLogin(username, password) {
        const user = await User.findOne({
            where: { username, isDeleted: false },
            include: [{ model: Wallet, as: 'wallet' }],
        });
        if (!user) throw new Error('ইউজার পাওয়া যায়নি!');

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) throw new Error('ভুল পাসওয়ার্ড!');

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        return { token, role: user.role };
    }
}

module.exports = new AuthService();
