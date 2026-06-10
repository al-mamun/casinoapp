/**
 * One-time script: restore player balances drained by HighAPI callback retries.
 * Run ONCE with:  node restore-balance.js
 * Delete this file after running.
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME     = process.env.DB_NAME || "betx365";

// ── EDIT THESE ────────────────────────────────────────────────────────────────
// Set the balance you want each affected player to have.
// Add more entries if other players were affected.
const RESTORE = [
    { username: "shimul", balance: 500 }
];
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
    if (!MONGODB_URI) { console.error("MONGODB_URI not set in .env"); process.exit(1); }
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log("Connected to MongoDB");

    const db      = client.db(DB_NAME);
    const users   = db.collection("users");
    const wallets = db.collection("wallets");

    for (const { username, balance } of RESTORE) {
        // Find user
        const user = await users.findOne({ username });
        if (!user) { console.warn(`User "${username}" not found — skipped`); continue; }

        const uid    = Number(user.id);
        const uidStr = String(user.id);

        console.log(`\nUser: ${username} (id=${uid})`);
        console.log(`  Current User.balance  = ${user.balance}`);

        const wallet = await wallets.findOne({ userId: { $in: [uid, uidStr] } });
        console.log(`  Current Wallet.balance = ${wallet?.balance ?? "(no wallet)"}`);

        // Update user
        await users.updateMany(
            { id: { $in: [uid, uidStr] } },
            { $set: { balance, updatedAt: new Date() } }
        );

        // Update wallet
        if (wallet) {
            await wallets.updateMany(
                { userId: { $in: [uid, uidStr] } },
                { $set: { balance, updatedAt: new Date() } }
            );
        } else {
            await wallets.insertOne({
                id: uid,
                userId: uid,
                balance,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            console.log("  Created missing wallet");
        }

        console.log(`  ✓ Restored balance to ${balance}`);
    }

    await client.close();
    console.log("\nDone. Restart the server after running this script.");
}

run().catch(err => { console.error(err); process.exit(1); });
