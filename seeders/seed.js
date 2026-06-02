const sequelize = require("../src/config/sequelize.db");
const Role = require("../src/modules/roles/role.model");
const Permission = require("../src/modules/roles/permission.model");

const roles = [
    { level: 1, name: "OWNER" },
    { level: 2, name: "MOTHER_PANEL" },
    { level: 3, name: "WHITE_LABEL" },
    { level: 4, name: "SUPER_ADMIN" },
    { level: 5, name: "ADMIN" },
    { level: 6, name: "B2B_SUB_ADMIN" },
    { level: 7, name: "B2C_SUB_ADMIN" },
    { level: 8, name: "SUPER_AGENT" },
    { level: 9, name: "MASTER_AGENT" },
    { level: 10, name: "SENIOR_AFFILIATE" },
    { level: 11, name: "AFFILIATE" },
    { level: 12, name: "PLAYER" }
];

const permissions = [
    { module: 'DOWNLINE', action: 'VIEW' },
    { module: 'ACCOUNT', action: 'VIEW' },
    { module: 'BETLIST', action: 'VIEW' },
    { module: 'RISK', action: 'VIEW' },
    { module: 'BANKING', action: 'VIEW' },
    { module: 'MATCH', action: 'CONTROL' },
    { module: 'RESULT', action: 'DECLARE' },
    { module: 'SETTINGS', action: 'UPDATE' },
    { module: 'MESSAGE', action: 'SEND' },
    { module: 'USER', action: 'BLOCK' },
    { module: 'USER', action: 'DELETE' },
    { module: 'WEBSITE', action: 'CONFIG' }
];

async function seedDatabase() {
    try {
        console.log("⏳ Connecting to database...");
        await sequelize.authenticate();

        console.log("⏳ Syncing models...");
        await sequelize.sync();

        console.log("⏳ Inserting Roles...");
        await Role.bulkCreate(roles, { ignoreDuplicates: true });

        console.log("⏳ Inserting Permissions...");
        await Permission.bulkCreate(permissions, { ignoreDuplicates: true });

        console.log("✅ Seeding completed successfully!");
        process.exit();
    } catch (error) {
        console.error("❌ Seeding failed:", error);
        process.exit(1);
    }
}

seedDatabase();