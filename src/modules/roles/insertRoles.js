const Role = require("./role.model"); // সঠিক path বসান

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

async function insertRoles() {
    try {
        await Role.bulkCreate(roles, { ignoreDuplicates: true });
        console.log("Roles successfully inserted!");
        process.exit();
    } catch (error) {
        console.error("Error inserting roles:", error);
        process.exit(1);
    }
}

insertRoles();