const bcrypt = require('bcryptjs');
const { User, Wallet } = require('../../models');
const { canCreate } = require('./role.engine');

function calculateDepositBonus(amount, pct, to) {
    return { bonus: (amount * pct) / 100, required: amount * to };
}

function referralCommission(loss, pct) {
    return (loss * pct) / 100;
}

async function getMyAgentInfo(playerId) {
    const player = await User.findByPk(playerId);
    if (!player || !player.parentId) return null;
    const agent = await User.findByPk(player.parentId, {
        attributes: ['id', 'username', 'phone', 'email'],
    });
    return agent ? agent.toJSON() : null;
}

async function registerUser(username, password, refCode) {
    // Referral code is required and must map to a MASTER_AGENT username
    const agent = await User.findOne({
        where: { username: refCode, role: 'MASTER_AGENT', isActive: true, isDeleted: false },
        attributes: ['id'],
    });

    if (!agent) {
        throw new Error('ভ্যালিড মাস্টার এজেন্ট রেফার কোড ছাড়া একাউন্ট করা সম্ভব নয়!');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
        username,
        password: hashedPassword,
        role: 'PLAYER',
        parentId: agent.id,
        referredBy: refCode,
    });

    // Create an empty wallet for the new player
    await Wallet.create({ userId: newUser.id });

    return { success: true, message: 'একাউন্ট তৈরি হয়েছে!', userId: newUser.id };
}

module.exports = {
    canCreateUser: canCreate,
    calculateDepositBonus,
    referralCommission,
    getMyAgentInfo,
    registerUser,
};
