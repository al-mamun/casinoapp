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
app.use("/api/admin", require("./routes/v1/admin.dynamic.routes"));
app.use("/api/player", require("./routes/v1/player.dynamic.routes"));

try { app.use('/api/auth', require('./modules/auth/auth.routes')); } catch {}
try { app.use('/api/admin', require('./modules/admin/admin.routes')); } catch {}

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

async function startServer() {
    try {
        await sequelize.authenticate();
        if (process.env.NODE_ENV !== 'production') await sequelize.sync({ alter: true });
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
