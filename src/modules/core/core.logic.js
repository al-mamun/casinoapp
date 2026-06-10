const { User } = require("../../models");
const { canCreate } = require('./role.engine');

async function getAllUsers() {
    try {
        return await User.findAll({ where: { isDeleted: false } });
    } catch (error) {
        throw new Error(`Failed to fetch users: ${error.message}`);
    }
}

async function createUser(creatorRole, targetRole, data) {
    try {
        if (!canCreate(creatorRole, targetRole)) {
            throw new Error('Permission denied: You cannot create this role');
        }
        const user = await User.create({
            username: data.username,
            password: data.password || '',
            role: targetRole,
            parentId: data.parentId || null,
        });
        return user.id;
    } catch (error) {
        throw new Error(`Failed to create user: ${error.message}`);
    }
}

module.exports = { getAllUsers, createUser };
