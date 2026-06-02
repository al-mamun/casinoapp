require('dotenv').config();
const bcrypt = require('bcryptjs');
const sequelize = require('../config/sequelize.db');
const { User, Wallet, Role, Permission, RolePermission, SystemSettings } = require('../models');

const ROLES = [
    { name: 'OWNER', level: 1 },
    { name: 'MOTHER_PANEL', level: 2 },
    { name: 'WHITE_LABEL', level: 3 },
    { name: 'SUPER_ADMIN', level: 4 },
    { name: 'ADMIN', level: 5 },
    { name: 'B2C_SUB_ADMIN', level: 6 },
    { name: 'SENIOR_AFFILIATE', level: 7 },
    { name: 'AFFILIATE', level: 8 },
    { name: 'B2B_SUB_ADMIN', level: 9 },
    { name: 'SUPER_AGENT', level: 10 },
    { name: 'MASTER_AGENT', level: 11 },
    { name: 'AGENT', level: 12 },
    { name: 'PLAYER', level: 13 }
];

const PERMISSION_MODULES = {
    DOWNLINE: ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'DEPOSIT', 'WITHDRAW'],
    ACCOUNT: ['VIEW', 'EDIT'],
    REPORT: ['VIEW'],
    BETLIST: ['VIEW', 'REJECT', 'CANCEL'],
    RISK: ['VIEW', 'UPDATE'],
    BANKING: ['VIEW', 'DEPOSIT', 'WITHDRAW', 'TRANSFER', 'APPROVE'],
    BANKING_METHOD: ['VIEW', 'CREATE', 'EDIT', 'DELETE'],
    MATCH: ['VIEW', 'CREATE', 'EDIT', 'BLOCK', 'CONTROL'],
    RESULT: ['VIEW', 'DECLARE', 'HOLD', 'RELEASE', 'ROLLBACK'],
    SETTINGS: ['VIEW', 'UPDATE'],
    MESSAGE: ['VIEW', 'CREATE', 'EDIT', 'DELETE'],
    USER: ['VIEW', 'CREATE', 'EDIT', 'BLOCK', 'DELETE', 'RESTORE'],
    WEBSITE: ['VIEW', 'UPDATE'],
    PRIVILEGES: ['VIEW', 'UPDATE', 'CLONE'],
    SURVEILLANCE: ['VIEW', 'UPDATE'],
    COMPANY_PAYMENT: ['VIEW', 'SETTLE', 'PAYOUT'],
    WHITELABEL: ['VIEW', 'CREATE', 'EDIT', 'LIMIT']
};

const DEFAULT_SETTINGS = [
    { key: 'site_name', value: 'BetX365', category: 'website', description: 'Site name' },
    { key: 'maintenance_mode', value: 'false', category: 'website', description: 'Maintenance mode on/off' },
    { key: 'min_bet', value: '10', category: 'defaults', description: 'Minimum bet amount' },
    { key: 'max_bet', value: '50000', category: 'defaults', description: 'Maximum bet amount' },
    { key: 'max_exposure', value: '100000', category: 'risk', description: 'Maximum exposure limit' },
    { key: 'max_liability', value: '100000', category: 'risk', description: 'Maximum liability limit' },
    { key: 'commission_base', value: '5', category: 'defaults', description: 'Base commission percentage' },
    { key: 'max_concurrent_sessions', value: '3', category: 'security', description: 'Max concurrent login sessions' },
    { key: 'p2p_enabled', value: 'false', category: 'p2p', description: 'P2P transfer enabled' },
    { key: 'p2p_max_amount', value: '10000', category: 'p2p', description: 'P2P max transfer amount' },
    { key: 'whitelabel_limit', value: '10', category: 'website', description: 'Max white-labels allowed' },
    { key: 'sports_main_market', value: '{"cricket":true,"football":true,"tennis":true}', category: 'sports', description: 'Default sports markets' }
];

async function seed() {
    try {
        await sequelize.authenticate();
        console.log('Database connected');

        // Sync all models
        await sequelize.sync({ alter: true });
        console.log('Tables synced');

        // 1. Create Roles
        console.log('Seeding roles...');
        for (const role of ROLES) {
            await Role.findOrCreate({
                where: { name: role.name },
                defaults: role
            });
        }
        console.log(`${ROLES.length} roles seeded`);

        // 2. Create Permissions
        console.log('Seeding permissions...');
        let permCount = 0;
        for (const [module, actions] of Object.entries(PERMISSION_MODULES)) {
            for (const action of actions) {
                await Permission.findOrCreate({
                    where: { module, action },
                    defaults: { module, action }
                });
                permCount++;
            }
        }
        console.log(`${permCount} permissions seeded`);

        // 3. Create Owner account
        console.log('Creating Owner account...');
        const ownerRole = await Role.findOne({ where: { name: 'OWNER' } });
        const hashedPassword = await bcrypt.hash('owner123', 10);

        const [owner, ownerCreated] = await User.findOrCreate({
            where: { username: 'owner' },
            defaults: {
                username: 'owner',
                password: hashedPassword,
                role: 'OWNER',
                roleId: ownerRole.id,
                parentId: null,
                fullName: 'System Owner',
                isActive: true,
                status: 'active',
                referralCode: 'OWNER-MAIN'
            }
        });

        if (ownerCreated) {
            await Wallet.findOrCreate({
                where: { userId: owner.id },
                defaults: { userId: owner.id, balance: 1000000 }
            });
            console.log('Owner created: username=owner, password=owner123');
        } else {
            console.log('Owner already exists');
        }

        // 4. Seed RolePermission junction rows (DB-backed permissions)
        console.log('Seeding role-permission mappings...');
        const { rolePermissions: hardcodedPerms } = require('../utils/rolePermissions');
        let rpCount = 0;

        for (const [roleName, perms] of Object.entries(hardcodedPerms)) {
            if (roleName === 'OWNER') continue; // OWNER uses wildcard '*', no DB entries needed
            const role = await Role.findOne({ where: { name: roleName } });
            if (!role) continue;

            for (const permStr of perms) {
                if (permStr === '*') continue;
                const [mod, actions] = permStr.split(':');
                for (const action of actions.split(',')) {
                    const perm = await Permission.findOne({ where: { module: mod, action } });
                    if (perm) {
                        await RolePermission.findOrCreate({
                            where: { roleId: role.id, permissionId: perm.id }
                        });
                        rpCount++;
                    }
                }
            }
        }
        console.log(`${rpCount} role-permission mappings seeded`);

        // 5. Create System Settings
        console.log('Seeding system settings...');
        for (const setting of DEFAULT_SETTINGS) {
            await SystemSettings.findOrCreate({
                where: { key: setting.key },
                defaults: setting
            });
        }
        console.log(`${DEFAULT_SETTINGS.length} settings seeded`);

        console.log('\n=== SEED COMPLETED SUCCESSFULLY ===');
        console.log('Owner Login: username=owner, password=owner123');
        console.log('API URL: http://localhost:3000/api/v1');

        process.exit(0);
    } catch (err) {
        console.error('Seed Error:', err);
        process.exit(1);
    }
}

seed();
