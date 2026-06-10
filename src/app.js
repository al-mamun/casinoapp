require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const http = require("http");

const sequelize = require("./config/sequelize.db");
require("./models/index");
const { errorHandler } = require("./middleware/errorHandler");
const permissionCache = require('./services/permissionCache');
const { getRealtimeSnapshot } = require("./services/dashboardMetrics.service");

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: { maxAge: 15552000, includeSubDomains: true, preload: true }
}));

const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({
    origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
        if (!allowedOrigins.length || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true
}));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many login attempts, try again later", errorCode: "RATE_LIMIT" }
});
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_GENERAL || 600),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests", errorCode: "RATE_LIMIT" }
});
app.use(generalLimiter);

const publicReadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_PUBLIC_READ || 1800),
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: true,
    message: { success: false, message: "Too many requests", errorCode: "RATE_LIMIT" }
});
app.use(["/api/v1/player/home", "/api/v1/website/public/site-config"], publicReadLimiter);

app.use('/api/v1/player/game-callback', express.raw({ type: '*/*', limit: process.env.CALLBACK_BODY_LIMIT || '2mb' }));
const skipParsedCallbackBody = (req) => {
    const url = req.originalUrl || req.url || req.path || "";
    return String(url).split("?")[0].replace(/\/$/, "") === "/api/v1/player/game-callback";
};
const jsonParser = express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' });
const urlencodedParser = express.urlencoded({ extended: true, limit: process.env.URLENCODED_BODY_LIMIT || '2mb' });
app.use((req, res, next) => skipParsedCallbackBody(req) ? next() : jsonParser(req, res, next));
app.use((req, res, next) => skipParsedCallbackBody(req) ? next() : urlencodedParser(req, res, next));
app.use(cookieParser());

let UPLOADS_DIR = (process.env.VERCEL || process.env.VERCEL_REGION || process.env.AWS_REGION)
    ? path.join('/tmp', 'uploads')
    : path.join(__dirname, '..', 'public', 'uploads');
try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (err) {
    UPLOADS_DIR = path.join('/tmp', 'uploads');
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    next();
}, express.static(UPLOADS_DIR, { maxAge: '1d', immutable: true }));

if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

function attachSocket(httpServer) {
    try {
        const { Server } = require("socket.io");
        const io = new Server(httpServer, { cors: { origin: "*", methods: ["GET", "POST"] } });
        io.on("connection", (socket) => socket.emit("system:connected", { connected: true, at: new Date().toISOString() }));
        setInterval(async () => {
            try {
                const snapshot = await getRealtimeSnapshot();
                io.emit("dashboard:realtime", snapshot);
            } catch {}
        }, 5000);
        return io;
    } catch {
        return null;
    }
}

function listen(port, label = '') {
    const httpServer = http.createServer(app);
    const io = attachSocket(httpServer);
    const server = httpServer.listen(port, () => {
        const suffix = label ? ` ${label}` : '';
        console.log(`Server running on port ${port}${suffix}`);
        console.log(`API: http://localhost:${port}/api/v1`);
        console.log(`Health: http://localhost:${port}/health`);
        if (io) console.log(`Socket.IO enabled on port ${port}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') return listen(Number(port) + 1, label);
        console.error("Server Error:", err.message);
        process.exit(1);
    });
    return server;
}

app.get('/health', async (req, res) => {
    try {
        await sequelize.authenticate();
        res.json({ success: true, message: 'Server is healthy', data: { server: 'running', database: 'connected', timestamp: new Date().toISOString(), uptime: process.uptime() } });
    } catch {
        res.status(500).json({ success: false, message: 'Server unhealthy', data: { server: 'running', database: 'disconnected' } });
    }
});


const v1Routes = require("./routes/v1");
app.use("/api/v1/auth/login", authLimiter);
app.use("/api/v1", v1Routes);
// NOTE: admin.dynamic.routes and player.dynamic.routes are already mounted under /api/v1
// via routes/v1/index.js — duplicate mounts below are removed to prevent privilege-bypass
// through the un-versioned paths.

try { app.use('/api/auth', require('./modules/auth/auth.routes')); } catch {}

app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'ExistingSky Backend API',
        version: 'v1.0',
        api: '/api/v1',
        health: '/health'
    });
});

app.get('/api/v1', (req, res) => {
    res.json({
        success: true,
        message: 'ExistingSky API v1',
        version: '1.0.0'
    });
});

app.get('/demo-games/:id', (req, res) => {
    res.status(404).json({ success: false, message: 'Demo games are disabled. Connect a live provider launch URL to open this game.', errorCode: 'DEMO_GAMES_DISABLED' });
});

// Friendly route helpers for frontend admin entrypoint
app.get(['/admin', '/frontend-main/admin'], (req, res) => {
    const frontendBase = String(process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5500/frontend-main').replace(/\/$/, '');
    return res.redirect(302, `${frontendBase}/admin/`);
});

app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route ${req.method} ${req.url} not found`, errorCode: 'NOT_FOUND' });
});
app.use(errorHandler);

async function normalizeWalletBalances() {
    // Full wallet repair pass on startup:
    //   1. Deduplicate wallet documents — same userId may have multiple docs (ghost upserts)
    //   2. Assign missing adapter 'id' fields so MongoRecord.save() works reliably
    //   3. Sync balance with User.balance (User.balance is source of truth)
    try {
        const { Wallet, User } = require("./models");
        const sequelize = require("./config/sequelize.db");
        const wc = await Wallet.collection();

        // --- Step 1: Deduplicate wallet documents per userId ---
        const allWallets = await wc.find({}).toArray();
        const byUserId = new Map();
        for (const doc of allWallets) {
            // Normalize userId to number for grouping
            const uid = Number(doc.userId);
            if (isNaN(uid)) continue;
            if (!byUserId.has(uid)) byUserId.set(uid, []);
            byUserId.get(uid).push(doc);
        }

        let deduped = 0;
        let idAssigned = 0;

        for (const [uid, docs] of byUserId) {
            // Sort: keep the one with the highest balance and most recent updatedAt
            docs.sort((a, b) => {
                const balDiff = Number(b.balance || 0) - Number(a.balance || 0);
                if (balDiff !== 0) return balDiff;
                return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
            });

            const keeper = docs[0];

            // Assign adapter 'id' if missing
            if (keeper.id === undefined || keeper.id === null) {
                const newId = await sequelize.nextId ? await sequelize.nextId("wallets") : null;
                if (newId) {
                    await wc.updateOne({ _id: keeper._id }, { $set: { id: newId } });
                    keeper.id = newId;
                    idAssigned++;
                }
            }

            // Delete duplicates (all docs except the keeper)
            for (let i = 1; i < docs.length; i++) {
                await wc.deleteOne({ _id: docs[i]._id });
                deduped++;
            }
        }

        if (deduped > 0) console.log(`[startup] Removed ${deduped} duplicate wallet document(s)`);
        if (idAssigned > 0) console.log(`[startup] Assigned id to ${idAssigned} wallet document(s) missing one`);

        // --- Step 2: Sync balance from User.balance ---
        const users = await User.findAll({ where: { isDeleted: false } });
        let synced = 0;

        for (const user of users) {
            const uid = Number(user.id);
            const userBalance = Number(user.balance || 0);

            const walletDoc = await wc.findOne({ userId: { $in: [uid, String(uid)] } });

            if (!walletDoc) {
                console.log(`[startup] No wallet found for userId=${uid} (${user.username || "?"}) — creating with balance=${userBalance}`);
                // Create a proper wallet through the model so it gets an id
                await Wallet.create({ userId: uid, balance: userBalance });
                synced++;
                continue;
            }

            const walletBalance = Number(walletDoc.balance || 0);
            // Log current state for all users so admin can see the picture
            console.log(`[startup] wallet userId=${uid} (${user.username || "?"}) walletBalance=${walletBalance} userBalance=${userBalance} walletId=${walletDoc.id ?? "none"}`);

            const needsSync = typeof walletDoc.balance !== "number"
                || isNaN(walletBalance)
                || userBalance > walletBalance;

            if (needsSync) {
                const correct = isNaN(userBalance) ? walletBalance : Math.max(userBalance, walletBalance);
                await wc.updateOne(
                    { _id: walletDoc._id },
                    { $set: { balance: correct, userId: uid, updatedAt: new Date() } }
                );
                console.log(`[startup] Fixed wallet userId=${uid}: ${walletBalance} → ${correct}`);
                synced++;
            } else if (typeof walletDoc.userId !== "number") {
                // Normalize userId to number while we're here
                await wc.updateOne({ _id: walletDoc._id }, { $set: { userId: uid } });
            }
        }

        if (synced > 0) console.log(`[startup] Synced ${synced} wallet balance(s)`);
    } catch (err) {
        console.warn("[startup] Wallet normalization skipped:", err.message);
    }
}

async function startServer() {
    if (String(process.env.DISABLE_RBAC || "false").toLowerCase() === "true") {
        console.warn('[SECURITY WARNING] DISABLE_RBAC=true — role-based access control is OFF. All authenticated users have OWNER-level access. Do NOT use this in production.');
    }
    try {
        await sequelize.authenticate();
        if (process.env.NODE_ENV !== 'production') await sequelize.sync({ alter: true });
        await normalizeWalletBalances();
        await permissionCache.init();
        listen(PORT);
    } catch (err) {
        console.error("Startup Error:", err.message);
        listen(PORT, "(with fallback permissions)");
    }
}

if (require.main === module && !process.env.VERCEL) startServer();
process.on("unhandledRejection", (err) => console.error("Unhandled Promise Rejection:", err));

module.exports = app;
