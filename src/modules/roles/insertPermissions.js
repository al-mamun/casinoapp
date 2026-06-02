const Permission = require("./permission.model");  // মডেলের সঠিক পাথ ব্যবহার করুন

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

async function insertPermissions() {
    try {
        // Permissions ডেটা ইনসার্ট করা
        await Permission.bulkCreate(permissions);
        console.log("Permissions successfully inserted!");
    } catch (error) {
        console.error("Error inserting permissions: ", error);
    }
}

// স্ক্রিপ্ট চালানো
insertPermissions();