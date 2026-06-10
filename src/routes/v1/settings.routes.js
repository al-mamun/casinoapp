const router = require("express").Router();
const crypto = require("crypto");
const { JWT_SECRET: _JWT_SECRET } = require("../../config");
const { SystemSettings } = require("../../models");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { success, error } = require("../../utils/apiResponse");
const AuditLog = require("../../core/audit.engine");

// Helper: get/set setting
async function getSetting(key) {
    const setting = await SystemSettings.findOne({ where: { key } });
    if (!setting) return null;
    try { return JSON.parse(setting.value); } catch { return setting.value; }
}

async function setSetting(key, value, category, userId) {
    const [setting, created] = await SystemSettings.findOrCreate({
        where: { key },
        defaults: { value: JSON.stringify(value), category, updatedBy: userId }
    });
    if (!created) {
        setting.value = JSON.stringify(value);
        setting.updatedBy = userId;
        await setting.save();
    }
    return setting;
}

const SECRET = crypto.createHash("sha256").update(_JWT_SECRET).digest();
function encryptSecret(value = "") {
    if (!value) return "";
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", SECRET, iv);
    const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}
function decryptSecret(value = "") {
    if (!value || !String(value).includes(":")) return value || "";
    const [ivHex, tagHex, encryptedHex] = String(value).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", SECRET, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
}
function maskSecret(value = "") {
    if (!value) return "";
    const plain = decryptSecret(value);
    if (plain.length <= 8) return "••••••••";
    return `${plain.slice(0, 4)}••••••${plain.slice(-4)}`;
}
function normalizeGameApiConfig(raw = {}, reveal = false) {
    const envSecret = process.env.HIGHAPI_SECRET_KEY || process.env.HIGHAPI_SECRET || "";
    const envApiKey = process.env.HIGHAPI_X_API_KEY || process.env.HIGHAPI_API_KEY || "";
    return {
        provider: process.env.HIGHAPI_PROVIDER || raw.provider || "marbel",
        enabled: raw.enabled !== undefined ? !!raw.enabled : process.env.HIGHAPI_ENABLED !== "false",
        baseUrl: process.env.HIGHAPI_BASE_URL || raw.baseUrl || "https://motherpanel.six444.com",
        launchPath: process.env.HIGHAPI_LAUNCH_PATH || raw.launchPath || "/api/v1/launch.php",
        gamesPath: process.env.HIGHAPI_GAMES_PATH || raw.gamesPath || "/api/v1/games.php",
        balancePath: raw.balancePath || "/api/v1/games.php",
        returnUrl: process.env.HIGHAPI_RETURN_URL || raw.returnUrl || "",
        callbackUrl: process.env.HIGHAPI_CALLBACK_URL || raw.callbackUrl || "",
        currencyCode: process.env.HIGHAPI_CURRENCY_CODE || raw.currencyCode || "BDT",
        organizationName: raw.organizationName || "",
        ipWhitelist: raw.ipWhitelist || "",
        xApiKey: reveal ? (envApiKey || decryptSecret(raw.xApiKey)) : (envApiKey ? maskSecret(envApiKey) : maskSecret(raw.xApiKey)),
        secretKey: reveal ? (envSecret || decryptSecret(raw.secretKey)) : (envSecret ? maskSecret(envSecret) : maskSecret(raw.secretKey)),
        updatedAt: raw.updatedAt || null
    };
}

function pickFirst(...values) {
    return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function extractProviderGameRows(result) {
    if (Array.isArray(result)) return result;
    const candidates = [
        result?.data,
        result?.data?.games,
        result?.data?.list,
        result?.data?.items,
        result?.games,
        result?.game_list,
        result?.gameList,
        result?.items,
        result?.list,
        result?.records
    ];
    return candidates.find(Array.isArray) || [];
}

function extractProviderTotal(result) {
    const values = [
        result?.total,
        result?.count,
        result?.total_count,
        result?.totalCount,
        result?.data?.total,
        result?.data?.count,
        result?.data?.total_count,
        result?.data?.totalCount,
        result?.pagination?.total,
        result?.meta?.total
    ];
    const found = values.find((value) => Number(value) > 0);
    return Number(found || 0);
}

function providerStatusFailed(result) {
    const status = result?.status ?? result?.code ?? result?.success;
    if (status === undefined || status === null) return false;
    if (typeof status === "boolean") return status === false;
    const normalized = String(status).toLowerCase();
    return !["success", "ok", "true", "1", "200"].includes(normalized);
}

function providerRequestHeaders(cfg) {
    return {
        "Accept": "application/json",
        "X-API-KEY": cfg.xApiKey
    };
}

function normalizeCategory(value = "") {
    const category = String(value || "").toLowerCase().replace(/[_\s]+/g, "-");
    if (["slots", "slot-game", "slot-games"].includes(category)) return "slot";
    if (["live", "live-casino", "casino-live"].includes(category)) return "casino";
    if (["fish", "fishing-game"].includes(category)) return "fishing";
    if (["table-game", "table-games", "card", "cards"].includes(category)) return "table";
    if (["crash-game", "crash-games"].includes(category)) return "crash";
    return category || "slot";
}

function withProviderQuery(url, params = {}) {
    const next = new URL(url);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") next.searchParams.set(key, value);
    });
    return next.toString();
}

function absoluteProviderAsset(url, baseUrl = "") {
    const value = String(url || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
    if (!baseUrl) return value;
    const base = baseUrl.replace(/\/$/, "");
    return value.startsWith("/") ? `${base}${value}` : `${base}/${value}`;
}

function normalizeSyncedGame(game, index, assetBaseUrl = "") {
    const id = pickFirst(game.id, game.game_id, game.gameId, game.game_uid, game.gameUid, game.uid, game.code, game.game_code, index + 1);
    return {
        id,
        name: pickFirst(game.game_name, game.gameName, game.name, game.title, game.en_name, `Game ${index + 1}`),
        gameUid: String(pickFirst(game.game_uid, game.gameUid, game.uid, game.game_code, game.code, game.id, id)),
        imageUrl: absoluteProviderAsset(pickFirst(
            game.thumbnail_url,
            game.thumbnailUrl,
            game.thumbnail,
            game.logo,
            game.logo_url,
            game.logoUrl,
            game.icon,
            game.icon_url,
            game.image,
            game.image_url,
            game.imageUrl,
            game.img,
            game.poster,
            game.cover
        ), assetBaseUrl),
        provider: String(pickFirst(game.provider_id, game.providerId, game.provider, game.brand_name, game.brandName, game.vendor, "HighAPI")).toUpperCase(),
        category: normalizeCategory(pickFirst(game.category, game.type, game.game_type, game.gameType, "slot")),
        badge: "LIVE",
        active: game.active !== false,
        sortOrder: index
    };
}

async function fetchProviderGamePage(cfg, url, params = {}) {
    const response = await fetch(withProviderQuery(url, params), { headers: providerRequestHeaders(cfg) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
        const err = new Error("Unable to sync games from provider");
        err.status = response.status || 502;
        throw err;
    }
    if (providerStatusFailed(result)) {
        const err = new Error(result.message || "Provider returned sync error");
        err.status = result.code || response.status || 502;
        throw err;
    }
    return {
        rows: extractProviderGameRows(result),
        total: extractProviderTotal(result),
        raw: result
    };
}

async function fetchAllProviderGames(cfg) {
    const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.gamesPath || "/api/v1/games.php"}`;
    const first = await fetchProviderGamePage(cfg, url);
    const firstRows = first.rows;
    if (!firstRows.length) return [];

    const maxGames = Number(process.env.HIGHAPI_MAX_SYNC_GAMES || 30000);
    const perPage = Number(process.env.HIGHAPI_SYNC_PAGE_SIZE || 500);
    const maxPages = Number(process.env.HIGHAPI_MAX_SYNC_PAGES || Math.ceil(maxGames / perPage) + 2);
    const allRows = [...firstRows];
    const seenSignatures = new Set(firstRows.map((row) => JSON.stringify(row).slice(0, 500)));

    if (firstRows.length >= maxGames || (first.total && firstRows.length >= first.total)) return firstRows.slice(0, maxGames);

    for (let page = 2; page <= maxPages && allRows.length < maxGames; page += 1) {
        const pageData = await fetchProviderGamePage(cfg, url, { page, per_page: perPage, limit: perPage });
        if (!pageData.rows.length) break;

        let added = 0;
        pageData.rows.forEach((row) => {
            const signature = JSON.stringify(row).slice(0, 500);
            if (seenSignatures.has(signature)) return;
            seenSignatures.add(signature);
            allRows.push(row);
            added += 1;
        });

        if (!added || pageData.rows.length < perPage) break;
        if (pageData.total && allRows.length >= pageData.total) break;
    }

    return allRows.slice(0, maxGames);
}

// GET /api/v1/settings/defaults
router.get("/defaults", authenticate, authorize('SETTINGS:VIEW'), asyncHandler(async (req, res) => {
    const defaults = {
        minBet: await getSetting('min_bet') || 10,
        maxBet: await getSetting('max_bet') || 50000,
        defaultOdds: await getSetting('default_odds') || 1.5,
        commissionBase: await getSetting('commission_base') || 5,
        maxExposure: await getSetting('max_exposure') || 100000,
        maxLiability: await getSetting('max_liability') || 100000
    };
    return success(res, defaults);
}));

// PATCH /api/v1/settings/defaults
router.patch("/defaults", authenticate, authorize('SETTINGS:UPDATE'), asyncHandler(async (req, res) => {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
        await setSetting(key, value, 'defaults', req.user.id);
    }

    await AuditLog.create({
        userId: req.user.id, action: "SETTINGS_UPDATED",
        description: `Updated defaults: ${Object.keys(updates).join(', ')}`, ipAddress: req.ip
    });

    return success(res, null, "Default settings updated");
}));

// GET /api/v1/settings/risk-limits
router.get("/risk-limits", authenticate, authorize('RISK:VIEW'), asyncHandler(async (req, res) => {
    const limits = {
        maxBet: await getSetting('max_bet') || 50000,
        maxLoss: await getSetting('max_loss') || 100000,
        maxExposure: await getSetting('max_exposure') || 100000,
        maxLiability: await getSetting('max_liability') || 100000
    };
    return success(res, limits);
}));

// PATCH /api/v1/settings/risk-limits
router.patch("/risk-limits", authenticate, authorize('RISK:UPDATE'), asyncHandler(async (req, res) => {
    const { maxBet, maxLoss, maxExposure, maxLiability } = req.body;
    if (maxBet) await setSetting('max_bet', maxBet, 'risk', req.user.id);
    if (maxLoss) await setSetting('max_loss', maxLoss, 'risk', req.user.id);
    if (maxExposure) await setSetting('max_exposure', maxExposure, 'risk', req.user.id);
    if (maxLiability) await setSetting('max_liability', maxLiability, 'risk', req.user.id);

    return success(res, null, "Risk limits updated");
}));

// GET /api/v1/settings/concurrent-users
router.get("/concurrent-users", authenticate, authorize('SETTINGS:VIEW'), asyncHandler(async (req, res) => {
    const limit = await getSetting('max_concurrent_sessions') || 3;
    return success(res, { maxConcurrentSessions: limit });
}));

// PATCH /api/v1/settings/concurrent-users
router.patch("/concurrent-users", authenticate, authorize('SETTINGS:UPDATE'), asyncHandler(async (req, res) => {
    await setSetting('max_concurrent_sessions', req.body.maxConcurrentSessions, 'security', req.user.id);
    return success(res, null, "Concurrent users limit updated");
}));

// GET /api/v1/settings/p2p
router.get("/p2p", authenticate, authorize('SETTINGS:VIEW'), asyncHandler(async (req, res) => {
    const data = {
        enabled: await getSetting('p2p_enabled') || false,
        maxTransferAmount: await getSetting('p2p_max_amount') || 10000,
        minTransferAmount: await getSetting('p2p_min_amount') || 100
    };
    return success(res, data);
}));

// PATCH /api/v1/settings/p2p
router.patch("/p2p", authenticate, authorize('SETTINGS:UPDATE'), asyncHandler(async (req, res) => {
    const { enabled, maxTransferAmount, minTransferAmount } = req.body;
    if (enabled !== undefined) await setSetting('p2p_enabled', enabled, 'p2p', req.user.id);
    if (maxTransferAmount) await setSetting('p2p_max_amount', maxTransferAmount, 'p2p', req.user.id);
    if (minTransferAmount) await setSetting('p2p_min_amount', minTransferAmount, 'p2p', req.user.id);

    return success(res, null, "P2P settings updated");
}));

// GET /api/v1/settings/sports-main-market
router.get("/sports-main-market", authenticate, authorize('SETTINGS:VIEW'), asyncHandler(async (req, res) => {
    const config = await getSetting('sports_main_market') || { cricket: true, football: true, tennis: true, basketball: false };
    return success(res, config);
}));

// PATCH /api/v1/settings/sports-main-market
router.patch("/sports-main-market", authenticate, authorize('SETTINGS:UPDATE'), asyncHandler(async (req, res) => {
    await setSetting('sports_main_market', req.body, 'sports', req.user.id);
    return success(res, null, "Sports main market updated");
}));

// GET /api/v1/settings/game-api
router.get("/game-api", authenticate, authorize('SETTINGS:VIEW'), asyncHandler(async (req, res) => {
    const current = await getSetting("game_api_credentials") || {};
    return success(res, normalizeGameApiConfig(current));
}));

// PATCH /api/v1/settings/game-api
router.patch("/game-api", authenticate, authorize('SETTINGS:UPDATE'), asyncHandler(async (req, res) => {
    const current = await getSetting("game_api_credentials") || {};
    const next = {
        ...current,
        provider: req.body.provider || current.provider || "marbel",
        enabled: req.body.enabled !== undefined ? !!req.body.enabled : !!current.enabled,
        baseUrl: req.body.baseUrl || "",
        launchPath: req.body.launchPath || "/api/v1/launch.php",
        gamesPath: req.body.gamesPath || "/api/v1/games.php",
        balancePath: req.body.balancePath || "/api/v1/games.php",
        returnUrl: req.body.returnUrl || "",
        callbackUrl: req.body.callbackUrl || "",
        currencyCode: req.body.currencyCode || current.currencyCode || process.env.HIGHAPI_CURRENCY_CODE || "BDT",
        organizationName: req.body.organizationName || "",
        ipWhitelist: req.body.ipWhitelist || "",
        updatedAt: new Date().toISOString()
    };
    if (req.body.xApiKey && !String(req.body.xApiKey).includes("••")) next.xApiKey = encryptSecret(req.body.xApiKey);
    if (req.body.secretKey && !String(req.body.secretKey).includes("••")) next.secretKey = encryptSecret(req.body.secretKey);

    await setSetting("game_api_credentials", next, "game_api", req.user.id);
    await AuditLog.create({
        userId: req.user.id,
        action: "GAME_API_SETTINGS_UPDATED",
        description: `Provider ${next.provider}, enabled=${next.enabled}`,
        ipAddress: req.ip
    });
    return success(res, normalizeGameApiConfig(next), "Game API credentials saved");
}));

// POST /api/v1/settings/game-api/test
router.post("/game-api/test", authenticate, authorize('SETTINGS:VIEW'), asyncHandler(async (req, res) => {
    const current = await getSetting("game_api_credentials") || {};
    const cfg = normalizeGameApiConfig(current, true);
    if (!cfg.baseUrl || !cfg.xApiKey || !cfg.secretKey) return error(res, "Game API credentials are incomplete", 400);

    const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.gamesPath || cfg.balancePath || "/"}`;
    try {
        const response = await fetch(url, { method: "GET", headers: providerRequestHeaders(cfg) });
        const data = await response.json().catch(() => ({}));
        if (providerStatusFailed(data)) {
            return error(res, data.message || "Game API responded with an error", data.code || response.status || 502, data.errorCode || "GAME_API_FAILED");
        }
        return success(res, { status: response.status, ok: response.ok, count: extractProviderGameRows(data).length, data }, response.ok ? "Game API connected" : "Game API responded with an error");
    } catch (err) {
        return error(res, `Game API connection failed: ${err.message}`, 502, "GAME_API_FAILED");
    }
}));

// POST /api/v1/settings/game-api/sync-games
router.post("/game-api/sync-games", authenticate, authorize('SETTINGS:UPDATE'), asyncHandler(async (req, res) => {
    const current = await getSetting("game_api_credentials") || {};
    const cfg = normalizeGameApiConfig(current, true);
    if (!cfg.baseUrl || !cfg.xApiKey) return error(res, "Game API key or base URL missing", 400);

    let rows = [];
    try {
        rows = await fetchAllProviderGames(cfg);
    } catch (err) {
        return error(res, err.message || "Unable to sync games from provider", err.status || 502);
    }
    const games = rows.map((game, index) => normalizeSyncedGame(game, index, cfg.baseUrl)).filter((game) => game.active !== false);

    await setSetting("games", games, "website", req.user.id);
    await AuditLog.create({
        userId: req.user.id,
        action: "GAME_API_SYNCED",
        description: `Synced ${games.length} games from ${cfg.provider}`,
        ipAddress: req.ip
    });
    return success(res, { count: games.length, games: games.slice(0, 10) }, `Synced ${games.length} games`);
}));

// GET /api/v1/settings/all
router.get("/all", authenticate, authorize('SETTINGS:VIEW'), asyncHandler(async (req, res) => {
    const { category } = req.query;
    const where = {};
    if (category) where.category = category;

    const settings = await SystemSettings.findAll({ where, order: [['category', 'ASC'], ['key', 'ASC']] });
    const parsed = settings.map(s => ({
        ...s.toJSON(),
        value: (() => { try { return JSON.parse(s.value); } catch { return s.value; } })()
    }));

    return success(res, parsed);
}));

module.exports = router;
