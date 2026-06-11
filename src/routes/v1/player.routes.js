const router = require("express").Router();

// ── In-memory wallet cache to make game-callback respond in < 200ms ──────────
// Keyed by userId (string). Evicted after 60 seconds.
const _walletCache = new Map(); // userId → {balance, expiresAt}
function cacheWallet(userId, balance) {
    _walletCache.set(String(userId), { balance: Number(balance), expiresAt: Date.now() + 60000 });
}
function getCachedBalance(userId) {
    const entry = _walletCache.get(String(userId));
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.balance;
}
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { Op, literal, Transaction: SequelizeTransaction } = require("sequelize");
const { success, error } = require("../../utils/apiResponse");
const { SystemSettings, User, Wallet, Transaction, Session } = require("../../models");
const { authenticate, generateToken, createSession } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");

async function getWebsiteSetting(key) {
    try {
        const setting = await SystemSettings.findOne({ where: { key, category: "website" } });
        if (!setting) return null;
        try { return JSON.parse(setting.value); } catch { return setting.value; }
    } catch {
        return null;
    }
}

async function getSetting(key) {
    try {
        const setting = await SystemSettings.findOne({ where: { key } });
        if (!setting) return null;
        try { return JSON.parse(setting.value); } catch { return setting.value; }
    } catch {
        return null;
    }
}

async function setSetting(key, value, category = "provider") {
    try {
        const [setting, created] = await SystemSettings.findOrCreate({
            where: { key },
            defaults: { key, value: JSON.stringify(value), category }
        });
        if (!created) {
            setting.value = JSON.stringify(value);
            setting.category = category;
            await setting.save();
        }
    } catch {}
}

async function appendSettingLog(key, entry, limit = 30) {
    try {
        const current = await getSetting(key);
        const rows = Array.isArray(current) ? current : [];
        rows.unshift(entry);
        await setSetting(key, rows.slice(0, limit), "debug");
    } catch {}
}

class ProviderApiError extends Error {
    constructor(message, status = 502, code = "GAME_PROVIDER_ERROR") {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const providerGamesCache = {
    value: null,
    expiresAt: 0,
    staleAt: 0,
    promise: null
};
const playerHomeCache = {
    value: null,
    expiresAt: 0,
    staleAt: 0,
    promise: null
};

function cacheMs(envKey, fallback) {
    const value = Number(process.env[envKey]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = cacheMs("PROVIDER_FETCH_TIMEOUT_MS", 8000)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

const { JWT_SECRET: _JWT_SECRET } = require("../../config");
const SECRET = crypto.createHash("sha256").update(_JWT_SECRET).digest();
const DEFAULT_HIGHAPI_CALLBACK_URL = "https://betx365-backend-kappa.vercel.app/api/v1/player/game-callback";
function decryptSecret(value = "") {
    if (!value || !String(value).includes(":")) return value || "";
    const [ivHex, tagHex, encryptedHex] = String(value).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", SECRET, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
}
function encryptLaunchPayload(payload, secretKey) {
    const key = Buffer.from(secretKey, "utf8");
    if (key.length !== 32) throw new Error("Provider secret key must be 32 characters for AES-256-ECB");
    const cipher = crypto.createCipheriv("aes-256-ecb", key, null);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]).toString("base64");
}

function normalizeHighApiConfig(raw = {}) {
    return {
        provider: process.env.HIGHAPI_PROVIDER || raw.provider || "HighAPI",
        enabled: raw.enabled !== undefined ? !!raw.enabled : process.env.HIGHAPI_ENABLED !== "false",
        baseUrl: process.env.HIGHAPI_BASE_URL || raw.baseUrl || "https://motherpanel.six444.com",
        launchPath: process.env.HIGHAPI_LAUNCH_PATH || raw.launchPath || "/api/v1/launch.php",
        gamesPath: process.env.HIGHAPI_GAMES_PATH || raw.gamesPath || "/api/v1/games.php",
        returnUrl: process.env.HIGHAPI_RETURN_URL || raw.returnUrl || "",
        callbackUrl: process.env.HIGHAPI_CALLBACK_URL || raw.callbackUrl || "",
        currencyCode: process.env.HIGHAPI_CURRENCY_CODE || raw.currencyCode || "BDT",
        xApiKey: process.env.HIGHAPI_X_API_KEY || process.env.HIGHAPI_API_KEY || decryptSecret(raw.xApiKey) || "",
        secretKey: process.env.HIGHAPI_SECRET_KEY || process.env.HIGHAPI_SECRET || decryptSecret(raw.secretKey) || ""
    };
}

function pickFirst(...values) {
    return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function pickDeep(object = {}, paths = []) {
    for (const path of paths) {
        const value = String(path).split(".").reduce((current, key) => current?.[key], object);
        if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return "";
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

function extractProviderBrands(result) {
    const providers = result?.data?.providers || result?.providers || result?.brands || result?.data?.brands || [];
    if (!Array.isArray(providers)) return new Map();
    return new Map(providers.map((provider) => [
        String(pickFirst(provider.brand_id, provider.provider_id, provider.id, provider.code)),
        {
            name: pickFirst(provider.brand_name, provider.provider_name, provider.name, provider.title),
            logoUrl: pickFirst(provider.logo_url, provider.logoUrl, provider.logo, provider.image_url, provider.image)
        }
    ]).filter(([id]) => id));
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

async function readProviderResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { message: text }; }
}

async function launchProviderGame(launchEndpoint, apiKey, encrypted, apiConfig, payload = {}) {
    const form = new URLSearchParams();
    form.set("payload", encrypted);
    form.set("token", apiKey);
    form.set("api_key", apiKey);
    Object.entries(payload).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") form.set(key, String(value));
    });

    const plainPayload = {
        ...payload,
        payload: encrypted,
        token: apiKey,
        api_key: apiKey
    };
    const plainForm = new URLSearchParams();
    Object.entries({ ...payload, token: apiKey, api_key: apiKey }).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") plainForm.set(key, String(value));
    });

    const attempts = [
        {
            method: "POST",
            headers: {
                ...providerRequestHeaders(apiConfig),
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: form.toString()
        },
        {
            method: "POST",
            headers: {
                ...providerRequestHeaders(apiConfig),
                "Content-Type": "application/json"
            },
            body: JSON.stringify(plainPayload)
        },
        {
            method: "POST",
            headers: {
                ...providerRequestHeaders(apiConfig),
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: plainForm.toString()
        },
        {
            method: "POST",
            headers: {
                ...providerRequestHeaders(apiConfig),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ...payload, token: apiKey, api_key: apiKey })
        }
    ];

    let last = null;
    for (const options of attempts) {
        const response = await fetchWithTimeout(launchEndpoint, options);
        const data = await readProviderResponse(response);
        last = { response, data };
        const message = String(data?.message || "");
        if (response.ok && !providerStatusFailed(data)) return last;
        if (!/content-type|invalid json|unsupported media|method not allowed|use post|system error|provider error/i.test(message)) return last;
    }
    return last;
}

function normalizeCategory(value = "") {
    const category = String(value || "").toLowerCase().replace(/[_\s]+/g, "-");
    if (["hot-game", "hot-games", "popular", "featured"].includes(category)) return "hot";
    if (["sportsbook", "sport", "sports-game", "exchange"].includes(category)) return "sports";
    if (["slots", "slot-game", "slot-games", "video-slot", "video-slots"].includes(category)) return "slot";
    if (["live", "live-casino", "casino-live", "live-dealer", "baccarat", "roulette"].includes(category)) return "casino";
    if (["fish", "fish-game", "fishing-game", "fishing-games"].includes(category)) return "fishing";
    if (["table-game", "table-games", "card", "cards", "board", "dice"].includes(category)) return "table";
    if (["crash-game", "crash-games", "instant"].includes(category)) return "crash";
    if (["arcade-game", "arcade-games", "mini-game", "mini-games"].includes(category)) return "arcade";
    if (["lotto", "number", "number-game", "number-games"].includes(category)) return "lottery";
    return category || "slot";
}

async function getHighApiConfig() {
    const current = await getSetting("game_api_credentials") || {};
    return normalizeHighApiConfig(current);
}

function absoluteProviderAsset(url, baseUrl = "") {
    const value = String(url || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
    if (!baseUrl) return value;
    const base = baseUrl.replace(/\/$/, "");
    return value.startsWith("/") ? `${base}${value}` : `${base}/${value}`;
}

function withProviderQuery(url, params = {}) {
    const next = new URL(url);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") next.searchParams.set(key, value);
    });
    return next.toString();
}

const LOCALHOST_RE = /localhost|127\.0\.0\.1|\/ui\/player|index\.html/i;

function safeProviderCallbackUrl(value, host) {
    // Priority 1: GAME_CALLBACK_URL env var (tunnel URL for local dev)
    const envOverride = String(process.env.GAME_CALLBACK_URL || "").trim();
    if (envOverride && !LOCALHOST_RE.test(envOverride)) return envOverride;

    // Priority 2: configured callbackUrl (from DB settings or HIGHAPI_CALLBACK_URL env)
    const url = String(value || "").trim();
    if (url && !LOCALHOST_RE.test(url)) return url;

    // Priority 3: derive from the current server's host (works automatically when deployed)
    if (host && !LOCALHOST_RE.test(host)) {
        return `${host.replace(/\/$/, "")}/api/v1/player/game-callback`;
    }

    // Priority 4: hardcoded production fallback
    return DEFAULT_HIGHAPI_CALLBACK_URL;
}

function toAmountValue(...values) {
    const found = values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
    if (found === undefined) return null;
    const normalized = typeof found === "string" ? found.replace(/,/g, "").trim() : found;
    const amount = Number(normalized);
    return Number.isFinite(amount) ? Number(amount.toFixed(2)) : null;
}

function toAmount(...values) {
    // Returns null when no valid numeric value is found.
    // Callers that need a 0 fallback should use: toAmount(...) ?? 0
    return toAmountValue(...values);
}

function parseMaybeJson(value) {
    if (!value || typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
}

function parseMaybeForm(value) {
    if (!value || typeof value !== "string" || !value.includes("=")) return null;
    try {
        return Object.fromEntries(new URLSearchParams(value));
    } catch {
        return null;
    }
}

function parseObjectFromString(value) {
    const json = parseMaybeJson(value);
    if (json && typeof json === "object" && !Array.isArray(json)) return json;
    const form = parseMaybeForm(value);
    if (form && typeof form === "object") return form;
    return null;
}

function encryptedPayloadCandidates(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return [];
    const candidates = [raw];
    try {
        const decoded = decodeURIComponent(raw);
        if (decoded && decoded !== raw) candidates.push(decoded);
    } catch {}
    const base64Url = raw.replace(/-/g, "+").replace(/_/g, "/");
    if (base64Url !== raw) candidates.push(base64Url);
    const padded = base64Url.padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
    if (padded !== base64Url) candidates.push(padded);
    return [...new Set(candidates)];
}

function decryptProviderPayload(value = "", secretKey = "") {
    if (!value || !secretKey) return null;
    const key = Buffer.from(secretKey, "utf8");
    if (key.length !== 32) return null;
    for (const candidate of encryptedPayloadCandidates(value)) {
        try {
            const decipher = crypto.createDecipheriv("aes-256-ecb", key, null);
            decipher.setAutoPadding(true);
            const text = Buffer.concat([decipher.update(Buffer.from(candidate, "base64")), decipher.final()]).toString("utf8");
            return parseObjectFromString(text) || parseMaybeJson(text);
        } catch {}
    }
    return null;
}

function firstObject(...values) {
    return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || null;
}

function pushObject(list, value) {
    if (value && typeof value === "object" && !Array.isArray(value)) list.push(value);
}

function callbackLogBody(req) {
    const rawBodyText = Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : (typeof req.body === "string" ? req.body : "");
    if (rawBodyText) return rawBodyText.length > 4000 ? `${rawBodyText.slice(0, 4000)}...<truncated>` : rawBodyText;
    return req.body && typeof req.body === "object" ? req.body : {};
}

function normalizeCallbackRef(value = "") {
    return String(value || "").trim();
}

function buildCallbackDebugEntry(req, payload, parsed = {}) {
    return {
        at: new Date().toISOString(),
        headers: {
            contentType: req.headers["content-type"] || "",
            userAgent: req.headers["user-agent"] || "",
            forwardedFor: req.headers["x-forwarded-for"] || ""
        },
        body: callbackLogBody(req),
        payload,
        parsed: {
            ...parsed,
            callbackUserRef: normalizeCallbackRef(parsed.callbackUserRef),
            username: normalizeCallbackRef(parsed.username),
            playerId: normalizeCallbackRef(parsed.playerId),
            externalId: normalizeCallbackRef(parsed.externalId),
            transactionId: normalizeCallbackRef(parsed.transactionId)
        }
    };
}

async function appendCallbackIssue(debugEntry, response, extra = {}) {
    const entry = {
        ...debugEntry,
        ...extra,
        response
    };
    await appendSettingLog("game_callback_debug", entry);
    return entry;
}

function pickCallbackUserRef(payload = {}) {
    return pickFirst(
        payload.member_account,
        payload.memberAccount,
        payload.member_account_id,
        payload.memberAccountId,
        payload.member,
        payload.player_uid,
        payload.playerUid,
        payload.player_id,
        payload.playerId,
        payload.playerid,
        payload.playerID,
        payload.user_id,
        payload.userId,
        payload.userid,
        payload.uid,
        payload.user,
        payload.account,
        payload.account_id,
        payload.accountId,
        payload.login,
        payload.login_id,
        payload.loginId,
        payload.external_id,
        payload.externalId,
        payload.external_id,
        payload.external,
        payload.username,
        payload.user_name,
        payload.player_name,
        payload.playerName
    );
}

function callbackErrorReason(prefix, details = {}) {
    const parts = [prefix];
    Object.entries(details).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        parts.push(`${key}=${value}`);
    });
    return parts.join(" | ");
}

function normalizeExternalRef(value = "") {
    return String(value || "").trim();
}

function normalizeUserLookupFields(payload = {}) {
    const userId = normalizeExternalRef(pickFirst(payload.userId, payload.user_id, payload.userid, payload.player_user_id, payload.playerUserId));
    const sessionId = normalizeExternalRef(pickFirst(payload.sessionId, payload.session_id, payload.session, payload.sid));
    const token = normalizeExternalRef(pickFirst(payload.token, payload.accessToken, payload.access_token, payload.authToken, payload.auth_token));
    const username = normalizeExternalRef(pickFirst(payload.username, payload.user_name, payload.player_name, payload.playerName));
    const playerId = normalizeExternalRef(pickFirst(payload.player_id, payload.playerId, payload.playerid, payload.playerID, payload.member_account_id, payload.memberAccountId));
    const externalId = normalizeExternalRef(pickFirst(payload.external_id, payload.externalId, payload.external, payload.account_id, payload.accountId));
    const callbackUserRef = normalizeExternalRef(pickCallbackUserRef(payload));
    return { userId, externalId, playerId, username, sessionId, token, callbackUserRef };
}

function buildIdentifierDebug(payload = {}, resolved = {}) {
    return {
        incoming: {
            userId: normalizeExternalRef(pickFirst(payload.userId, payload.user_id, payload.userid, payload.player_user_id, payload.playerUserId)),
            sessionId: normalizeExternalRef(pickFirst(payload.sessionId, payload.session_id, payload.session, payload.sid)),
            token: normalizeExternalRef(pickFirst(payload.token, payload.accessToken, payload.access_token, payload.authToken, payload.auth_token)),
            externalId: normalizeExternalRef(pickFirst(payload.externalId, payload.external_id, payload.external, payload.accountId, payload.account_id)),
            playerId: normalizeExternalRef(pickFirst(payload.playerId, payload.player_id, payload.playerid, payload.playerID, payload.memberAccountId, payload.member_account_id)),
            username: normalizeExternalRef(pickFirst(payload.username, payload.user_name, payload.player_name, payload.playerName))
        },
        resolved
    };
}

function stableReferenceId(...parts) {
    return parts
        .map((part) => normalizeExternalRef(part))
        .filter(Boolean)
        .join("|");
}

function normalizeMoney(value, fallback = 0) {
    const amount = toAmountValue(value);
    return Number.isFinite(amount) ? amount : Number(fallback || 0);
}

async function findUserByCallbackRef({ callbackUserRef, username, playerId, externalId }) {
    let user = null;
    const numericUserId = Number(callbackUserRef);
    if (Number.isFinite(numericUserId) && numericUserId > 0) {
        user = await User.findByPk(numericUserId).catch(() => null);
    }
    if (!user && username) {
        user = await User.findOne({ where: { username } }).catch(() => null);
    }
    if (!user && playerId) {
        user = await User.findOne({
            where: {
                [Op.or]: [
                    { username: playerId },
                    { referralCode: playerId }
                ]
            }
        }).catch(() => null);
    }
    if (!user && externalId) {
        user = await User.findOne({
            where: {
                [Op.or]: [
                    { username: externalId },
                    { referralCode: externalId }
                ]
            }
        }).catch(() => null);
    }
    return user;
}

async function findUserByProviderIdentifiers(identifiers = {}) {
    const { userId, externalId, playerId, username, sessionId, token, callbackUserRef } = identifiers;
    const attempts = [
        { key: "userId", value: userId, lookup: async (value) => User.findByPk(Number(value)).catch(() => null) },
        { key: "externalId", value: externalId, lookup: async (value) => User.findOne({ where: { [Op.or]: [{ username: String(value) }, { referralCode: String(value) }] } }).catch(() => null) },
        { key: "playerId", value: playerId, lookup: async (value) => User.findOne({ where: { [Op.or]: [{ username: String(value) }, { referralCode: String(value) }] } }).catch(() => null) },
        { key: "username", value: username, lookup: async (value) => User.findOne({ where: { username: String(value) } }).catch(() => null) },
        {
            key: "sessionId",
            value: sessionId,
            lookup: async (value) => {
                const sessionRow = await Session.findOne({ where: { sessionId: String(value) } }).catch(() => null);
                if (!sessionRow?.userId) return null;
                return User.findByPk(Number(sessionRow.userId)).catch(() => null);
            }
        },
        {
            key: "token",
            value: token,
            lookup: async (value) => {
                const sessionRow = await Session.findOne({ where: { token: String(value) } }).catch(() => null);
                if (!sessionRow?.userId) return null;
                return User.findByPk(Number(sessionRow.userId)).catch(() => null);
            }
        },
        { key: "callbackUserRef", value: callbackUserRef, lookup: async (value) => {
            const numericUserId = Number(value);
            if (Number.isFinite(numericUserId) && numericUserId > 0) return User.findByPk(numericUserId).catch(() => null);
            return null;
        } }
    ];

    for (const attempt of attempts) {
        if (attempt.value === undefined || attempt.value === null || String(attempt.value).trim() === "") continue;
        const result = await attempt.lookup(attempt.value);
        if (result) return { user: result, resolvedIdentifier: attempt.key, resolvedValue: String(attempt.value) };
    }
    return { user: null, resolvedIdentifier: null, resolvedValue: null };
}

async function resolveWalletContext(payload = {}, req = null) {
    const identifiers = normalizeUserLookupFields(payload || {});
    const lookup = await findUserByProviderIdentifiers(identifiers);
    const user = lookup.user;
    if (!user) return { user: null, wallet: null, identifiers, lookup };

    const wallet = await Wallet.findOne({ where: { userId: user.id } }).catch(() => null);
    const debug = buildIdentifierDebug(payload, {
        resolvedIdentifier: lookup.resolvedIdentifier,
        resolvedValue: lookup.resolvedValue,
        matchedUserId: user.id,
        walletId: wallet?.id || null,
        walletBalance: Number(wallet?.balance || 0),
        requestPath: req?.originalUrl || req?.url || "",
        requestMethod: req?.method || ""
    });
    return { user, wallet, identifiers, lookup, debug };
}

async function logBalanceDebug(entry) {
    await appendSettingLog("game_balance_debug", entry);
}

async function ensureWalletForUser(userId) {
    let wallet = await Wallet.findOne({ where: { userId } }).catch(() => null);
    if (wallet) return wallet;
    // Wallet document missing — seed balance from the User record so we don't
    // accidentally create a 0-balance wallet and wipe out a deposit.
    let seedBalance = 0;
    try {
        const userRow = await User.findByPk(Number(userId));
        seedBalance = Number(userRow?.balance || 0);
    } catch {}
    console.log(`[ensureWalletForUser] Creating wallet for userId=${userId} with seed balance=${seedBalance}`);
    wallet = await Wallet.create({ userId: Number(userId), balance: seedBalance }).catch(() => null);
    return wallet;
}

async function updateWalletBalanceAtomic({ wallet, userId, delta, description, referenceId, referenceType, transactionType }) {
    // The MongoDB adapter does not support real Sequelize transactions or row locks.
    // We do a read-check-write sequence with Number() casting to avoid BSON type issues.
    const lockedWallet = await Wallet.findOne({ where: { userId } });
    if (!lockedWallet) throw new Error("Wallet not found");

    const before = Number(Number(lockedWallet.balance || 0).toFixed(2));
    const after = Number((before + Number(delta || 0)).toFixed(2));

    if (after < 0) {
        return { ok: false, before, after: before, wallet: lockedWallet };
    }

    const uid = Number(userId);
    const uidStr = String(userId);
    // updateMany covers any leftover duplicate wallet documents
    try {
        const walletCollection = await Wallet.collection();
        await walletCollection.updateMany(
            { userId: { $in: [uid, uidStr] } },
            { $set: { balance: after, updatedAt: new Date() } }
        );
    } catch {
        if (lockedWallet._id) {
            try {
                const walletCollection = await Wallet.collection();
                await walletCollection.updateOne({ _id: lockedWallet._id }, { $set: { balance: after, updatedAt: new Date() } });
            } catch {
                lockedWallet.balance = after;
                await lockedWallet.save();
            }
        } else {
            lockedWallet.balance = after;
            await lockedWallet.save();
        }
    }
    // Sync User.balance (hook not supported by MongoDB adapter)
    try {
        const { User } = require("../../models");
        const userCollection = await User.collection();
        await userCollection.updateMany(
            { id: { $in: [uid, uidStr] } },
            { $set: { balance: after, updatedAt: new Date() } }
        );
    } catch {}
    lockedWallet.balance = after;

    // Upsert the ledger entry
    let transactionRow;
    try {
        const [row, created] = await Transaction.findOrCreate({
            where: { userId, referenceId: referenceId || null },
            defaults: {
                userId,
                type: transactionType || "GAME_SETTLEMENT",
                amount: Math.abs(Number(delta || 0)),
                balanceBefore: before,
                balanceAfter: after,
                status: "COMPLETED",
                description: description || "",
                referenceId: referenceId || null,
                referenceType: referenceType || "GAME_CALLBACK"
            }
        });
        if (!created) {
            row.amount = Math.abs(Number(delta || 0));
            row.balanceBefore = before;
            row.balanceAfter = after;
            row.status = "COMPLETED";
            if (description) row.description = description;
            if (referenceId) row.referenceId = referenceId;
            if (referenceType) row.referenceType = referenceType;
            await row.save();
        }
        transactionRow = row;
    } catch (txErr) {
        console.error('[updateWalletBalanceAtomic] Ledger write failed:', txErr.message);
    }

    return { ok: true, before, after, wallet: lockedWallet, transaction: transactionRow };
}

async function normalizeCallbackPayload(req) {
    const cfg = await getHighApiConfig().catch(() => ({}));
    const rawBodyText = Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : (typeof req.body === "string" ? req.body : "");
    const parsedRawBody = parseObjectFromString(rawBodyText);
    const body = rawBodyText
        ? { raw_body: rawBodyText, ...(parsedRawBody || {}) }
        : (req.body && typeof req.body === "object" ? req.body : {});
    const raw = { ...(req.query || {}), ...body };
    const objects = [raw];
    pushObject(objects, decryptProviderPayload(rawBodyText, cfg.secretKey));

    for (let index = 0; index < objects.length; index += 1) {
        const current = objects[index];
        for (const key of ["encrypted_payload", "encryptedPayload", "payload", "data"]) {
            const value = current?.[key];
            if (typeof value === "string") {
                pushObject(objects, parseObjectFromString(value));
                pushObject(objects, decryptProviderPayload(value, cfg.secretKey));
            } else {
                pushObject(objects, value);
            }
        }
    }

    return objects.reduce((merged, object) => ({ ...merged, ...object }), {});
}

function inferCallbackAmounts(payload = {}) {
    const action = String(pickFirst(
        payload.action,
        payload.type,
        payload.event,
        payload.method,
        payload.command,
        payload.cmd,
        payload.operation,
        payload.transaction_type,
        payload.transactionType
    )).toLowerCase();
    const amount = toAmountValue(payload.amount, payload.money, payload.value, payload.transfer_amount, payload.transferAmount);
    const creditAmount = toAmountValue(payload.credit_amount, payload.creditAmount);
    let bet = toAmount(payload.bet_amount, payload.betAmount, payload.bet, payload.stake, payload.wager, payload.debit_amount, payload.debitAmount, payload.debit);
    let win = toAmount(payload.win_amount, payload.winAmount, payload.win, payload.payout, payload.payout_amount, payload.payoutAmount);
    let refund = toAmount(payload.refund_amount, payload.refundAmount, payload.refund, payload.cancel_amount, payload.cancelAmount, payload.rollback_amount, payload.rollbackAmount);

    const isBalance = /balance|getbalance|checkbalance/i.test(action);
    const isDebit = /bet|debit|withdraw|stake|wager/i.test(action);
    const isCredit = /win|credit|settle|settlement|payout|result/i.test(action);
    const isRefund = /refund|cancel|rollback|void|return/i.test(action);

    if (!isBalance) {
        // Only fall back to generic `amount` when the dedicated field is absent (null/undefined).
        // IMPORTANT: use strict null checks (=== null) rather than falsy checks so that a
        // legitimate 0 value (no win, no bet) is NOT overwritten by a balance-looking field
        // like credit_amount that many providers set to the player's current balance.
        if (isDebit  && bet     === null && amount       !== null) bet    = Math.abs(amount);
        if (isCredit && win     === null && amount       !== null) win    = Math.max(0, amount);
        // credit_amount is often the player's *current balance*, not a win amount — only use
        // it as win if win is genuinely absent AND the amount field wasn't already used.
        if (isCredit && win     === null && creditAmount !== null) win    = Math.max(0, creditAmount);
        if (isRefund && refund  === null && amount       !== null) refund = Math.abs(amount);
        if (!action  && amount  !== null && amount < 0)           bet    = Math.abs(amount);
    }

    let settlementType = "settle";
    if (isBalance) settlementType = "balance";
    else if (refund > 0 || isRefund) settlementType = "refund";
    else if (bet > 0 && win > 0) settlementType = "settle";
    else if (bet > 0) settlementType = "debit";
    else if (win > 0) settlementType = "win";
    else if (isDebit) settlementType = "debit";
    else if (isCredit) settlementType = "win";

    // Normalize nulls to 0 for callers that expect numbers
    bet    = bet    ?? 0;
    win    = win    ?? 0;
    refund = refund ?? 0;
    return { action, settlementType, bet, win, refund, amount };
}

function callbackBalanceResponse(wallet, extra = {}) {
    const balance = Number(Number(wallet?.balance || 0).toFixed(2));
    return {
        success: true,
        status: 1,
        errCode: 0,
        error_code: 0,
        credit_amount: balance,
        balance,
        current_balance: balance,
        available_balance: balance,
        player_balance: balance,
        user_balance: balance,
        amount: balance,
        timestamp: Date.now(),
        ...extra
    };
}

function stablePayloadHash(payload = {}) {
    const normalized = {};
    Object.keys(payload || {}).sort().forEach((key) => {
        const value = payload[key];
        if (value !== undefined && typeof value !== "function") normalized[key] = value;
    });
    return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 32);
}

let transactionReferenceIndexReady = false;
async function ensureTransactionReferenceIndex() {
    if (transactionReferenceIndexReady) return;
    try {
        if (typeof Transaction.collection !== "function") {
            transactionReferenceIndexReady = true;
            return;
        }
        const collection = await Transaction.collection();
        await collection.createIndex(
            { userId: 1, referenceType: 1, referenceId: 1 },
            { unique: true, sparse: true, name: "uniq_transaction_reference" }
        );
        transactionReferenceIndexReady = true;
    } catch {
        // Existing duplicate rows should not block the runtime idempotency guard.
        transactionReferenceIndexReady = true;
    }
}

async function reserveGameTransaction({ userId, referenceId, referenceType, description }) {
    await ensureTransactionReferenceIndex();
    const where = { userId, referenceId, referenceType };
    const existing = await Transaction.findOne({ where }).catch(() => null);
    if (existing) return { transaction: existing, duplicate: true };

    try {
        const transaction = await Transaction.create({
            userId,
            type: "GAME_SETTLEMENT",
            amount: 0,
            balanceBefore: null,
            balanceAfter: null,
            description,
            referenceId,
            referenceType,
            status: "PENDING"
        });
        return { transaction, duplicate: false };
    } catch (err) {
        if (err?.code === 11000 || /duplicate/i.test(String(err?.message || ""))) {
            const duplicate = await Transaction.findOne({ where }).catch(() => null);
            if (duplicate) return { transaction: duplicate, duplicate: true };
        }
        throw err;
    }
}

async function markGameTransactionFailed(transaction, message = "Failed") {
    if (!transaction || transaction.status !== "PENDING") return;
    transaction.status = "FAILED";
    transaction.description = `${transaction.description || "Game transaction"} - ${message}`;
    await transaction.save().catch(() => null);
}

async function applyWalletSettlement({ wallet, userId, bet = 0, win = 0, refund = 0 }) {
    const normalizedBet = Number(Number(bet || 0).toFixed(2));
    const normalizedWin = Number(Number(win || 0).toFixed(2));
    const normalizedRefund = Number(Number(refund || 0).toFixed(2));
    if (
        !Number.isFinite(normalizedBet) ||
        !Number.isFinite(normalizedWin) ||
        !Number.isFinite(normalizedRefund) ||
        normalizedBet < 0 ||
        normalizedWin < 0 ||
        normalizedRefund < 0
    ) {
        const current = Number(Number(wallet?.balance || 0).toFixed(2));
        return { ok: false, code: "INVALID_AMOUNT", before: current, after: current, netAmount: 0 };
    }
    const netAmount = Number((normalizedWin + normalizedRefund - normalizedBet).toFixed(2));

    const before = Number(Number(wallet.balance || 0).toFixed(2));
    if (normalizedBet > before) {
        return { ok: false, code: "INSUFFICIENT_BALANCE", before, after: before, netAmount };
    }
    const after = Number((before + netAmount).toFixed(2));

    const uid = Number(userId);
    const uidStr = String(userId);

    // Use updateMany so ALL wallet documents for this userId are updated (handles leftover
    // duplicates from previous ghost-upsert bug). After startup normalizer runs, there
    // should only ever be one document per userId, but updateMany is safe either way.
    try {
        const walletCollection = await Wallet.collection();
        await walletCollection.updateMany(
            { userId: { $in: [uid, uidStr] } },
            { $set: { balance: after, updatedAt: new Date() } }
        );
    } catch (collErr) {
        // Fallback: use wallet's native MongoDB _id (always present on fetched docs)
        if (wallet._id) {
            try {
                const walletCollection = await Wallet.collection();
                await walletCollection.updateOne(
                    { _id: wallet._id },
                    { $set: { balance: after, updatedAt: new Date() } }
                );
            } catch {
                wallet.balance = after;
                await wallet.save();
            }
        } else {
            wallet.balance = after;
            await wallet.save();
        }
    }

    // Keep User.balance in sync (hook doesn't fire in the MongoDB adapter)
    try {
        const { User } = require("../../models");
        const userCollection = await User.collection();
        await userCollection.updateMany(
            { id: { $in: [uid, uidStr] } },
            { $set: { balance: after, updatedAt: new Date() } }
        );
    } catch {}

    wallet.balance = after;
    return { ok: true, before, after, netAmount };
}

function pickProviderImage(game = {}) {
    return pickFirst(
        pickDeep(game, [
            "images.thumbnail",
            "images.logo",
            "images.icon",
            "images.square",
            "images.vertical",
            "images.horizontal",
            "assets.thumbnail",
            "assets.logo",
            "assets.icon",
            "media.thumbnail",
            "media.logo",
            "media.icon"
        ]),
        game.thumbnail_url,
        game.thumbnailUrl,
        game.thumbnail,
        game.thumb_url,
        game.thumbUrl,
        game.thumb,
        game.logo,
        game.logo_url,
        game.logoUrl,
        game.icon,
        game.icon_url,
        game.iconUrl,
        game.image,
        game.image_url,
        game.imageUrl,
        game.img,
        game.img_url,
        game.imgUrl,
        game.poster,
        game.poster_url,
        game.posterUrl,
        game.cover,
        game.cover_url,
        game.coverUrl,
        game.game_image,
        game.gameImage,
        game.game_img,
        game.gameImg,
        game.game_icon,
        game.gameIcon,
        game.picture,
        game.picture_url
    );
}

function normalizeProviderGame(game, index, assetBaseUrl = "", providerMap = new Map()) {
    const id = pickFirst(game.id, game.game_id, game.gameId, game.game_uid, game.gameUid, game.uid, game.code, game.game_code, index + 1);
    const gameUid = pickFirst(game.game_uid, game.gameUid, game.uid, game.game_code, game.code, game.id, id);
    const providerId = String(pickFirst(game.provider_id, game.providerId, game.brand_id, game.brandId, ""));
    const providerInfo = providerMap.get(providerId) || {};
    const provider = pickFirst(game.provider, game.brand_name, game.brandName, game.vendor, game.vendor_code, providerInfo.name, providerId, "HighAPI");
    const gameImage = pickProviderImage(game);
    return {
        id,
        name: pickFirst(game.game_name, game.gameName, game.name, game.title, game.en_name, `Game ${index + 1}`),
        gameUid: String(gameUid),
        category: normalizeCategory(pickFirst(game.category, game.type, game.game_type, game.gameType, game.product_type, game.productType, "slot")),
        provider: String(provider).toUpperCase(),
        providerId,
        badge: game.badge || "LIVE",
        imageUrl: absoluteProviderAsset(gameImage || providerInfo.logoUrl, assetBaseUrl),
        providerLogoUrl: absoluteProviderAsset(providerInfo.logoUrl, assetBaseUrl),
        raw: game,
        color: colors[index % colors.length],
        sort: index + 1,
        active: game.active !== false
    };
}

async function fetchProviderGamePage(cfg, url, params = {}) {
    const response = await fetchWithTimeout(withProviderQuery(url, params), { headers: providerRequestHeaders(cfg) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
        throw new ProviderApiError("Game API did not return a valid response", response.status || 502);
    }
    if (providerStatusFailed(result)) {
        throw new ProviderApiError(result.message || "Game API returned an error", result.code || response.status || 502, result.errorCode || "GAME_PROVIDER_ERROR");
    }
    return {
        rows: extractProviderGameRows(result),
        total: extractProviderTotal(result),
        providerMap: extractProviderBrands(result)
    };
}

async function fetchAllProviderGames(cfg) {
    const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.gamesPath || "/api/v1/games.php"}`;
    const maxGames = Number(process.env.HIGHAPI_HOME_GAME_LIMIT || process.env.HIGHAPI_MAX_SYNC_GAMES || 30000);
    const perPage = Number(process.env.HIGHAPI_SYNC_PAGE_SIZE || 500);
    const maxPages = Number(process.env.HIGHAPI_MAX_SYNC_PAGES || Math.ceil(maxGames / perPage) + 2);
    const first = await fetchProviderGamePage(cfg, url);
    const allRows = [...first.rows];
    const providerMap = new Map(first.providerMap || []);
    const seen = new Set(first.rows.map((row) => String(pickFirst(row.game_uid, row.gameUid, row.uid, row.game_code, row.code, row.id, JSON.stringify(row).slice(0, 500)))));

    if (!first.rows.length || allRows.length >= maxGames || (first.total && allRows.length >= first.total)) {
        return { rows: allRows.slice(0, maxGames), total: first.total || allRows.length, providerMap };
    }

    for (let page = 2; page <= maxPages && allRows.length < maxGames; page += 1) {
        const pageData = await fetchProviderGamePage(cfg, url, { page, per_page: perPage, limit: perPage });
        if (!pageData.rows.length) break;
        (pageData.providerMap || new Map()).forEach((value, key) => providerMap.set(key, value));

        let added = 0;
        pageData.rows.forEach((row) => {
            const key = String(pickFirst(row.game_uid, row.gameUid, row.uid, row.game_code, row.code, row.id, JSON.stringify(row).slice(0, 500)));
            if (seen.has(key)) return;
            seen.add(key);
            allRows.push(row);
            added += 1;
        });

        if (!added || pageData.rows.length < perPage) break;
        if (pageData.total && allRows.length >= pageData.total) break;
    }

    return { rows: allRows.slice(0, maxGames), total: first.total || allRows.length, providerMap };
}

async function fetchProviderGamesUncached() {
    const cfg = await getHighApiConfig();
    if (!cfg.enabled || !cfg.baseUrl || !cfg.xApiKey) return { games: [], error: null, configured: false };
    try {
        const { rows, total, providerMap } = await fetchAllProviderGames(cfg);
        const maxHomeGames = Number(process.env.HIGHAPI_HOME_GAME_LIMIT || process.env.HIGHAPI_MAX_SYNC_GAMES || 30000);
        const games = rows
            .slice(0, total ? Math.min(rows.length, maxHomeGames) : maxHomeGames)
            .map((game, index) => normalizeProviderGame(game, index, cfg.baseUrl, providerMap))
            .filter((game) => game.active !== false);
        if (games.length) {
            setSetting("provider_games_cache", {
                games,
                total: total || games.length,
                cachedAt: new Date().toISOString()
            });
        }
        return { games, error: null, configured: true, total };
    } catch (err) {
        const cached = await getSetting("provider_games_cache");
        if (Array.isArray(cached?.games) && cached.games.length) {
            return {
                games: cached.games,
                error: {
                    message: err.message || "Game API failed; serving cached games",
                    status: err.status || 502,
                    code: err.code || "GAME_PROVIDER_ERROR",
                    cachedAt: cached.cachedAt || null
                },
                configured: true,
                total: cached.total || cached.games.length,
                cached: true
            };
        }
        throw err;
    }
}

async function readStoredProviderGames() {
    const cached = await getSetting("provider_games_cache");
    if (!Array.isArray(cached?.games) || !cached.games.length) return null;
    return {
        games: cached.games,
        error: cached.error || null,
        configured: true,
        total: cached.total || cached.games.length,
        cached: true,
        cachedAt: cached.cachedAt || null
    };
}

async function fetchProviderGames() {
    const now = Date.now();
    if (providerGamesCache.value && now < providerGamesCache.expiresAt) {
        return providerGamesCache.value;
    }
    if (providerGamesCache.promise) {
        if (providerGamesCache.value && now < providerGamesCache.staleAt) return providerGamesCache.value;
        return providerGamesCache.promise;
    }

    providerGamesCache.promise = fetchProviderGamesUncached()
        .then((value) => {
            const ttl = cacheMs("PROVIDER_GAMES_CACHE_MS", 60 * 1000);
            const staleTtl = cacheMs("PROVIDER_GAMES_STALE_MS", 10 * 60 * 1000);
            providerGamesCache.value = value;
            providerGamesCache.expiresAt = Date.now() + ttl;
            providerGamesCache.staleAt = Date.now() + staleTtl;
            return value;
        })
        .finally(() => {
            providerGamesCache.promise = null;
        });

    if (providerGamesCache.value && now < providerGamesCache.staleAt) {
        const refreshPromise = providerGamesCache.promise;
        if (refreshPromise) refreshPromise.catch(() => null);
        return providerGamesCache.value;
    }

    const stored = await readStoredProviderGames().catch(() => null);
    if (stored) {
        providerGamesCache.value = stored;
        providerGamesCache.expiresAt = Date.now() + cacheMs("PROVIDER_GAMES_COLD_CACHE_MS", 30 * 1000);
        providerGamesCache.staleAt = Date.now() + cacheMs("PROVIDER_GAMES_STALE_MS", 10 * 60 * 1000);
        const refreshPromise = providerGamesCache.promise;
        if (refreshPromise) refreshPromise.catch(() => null);
        return stored;
    }

    return providerGamesCache.promise;
}

const iconMap = {
    home: "fa-house",
    hot: "fa-fire-flame-curved",
    sports: "fa-futbol",
    casino: "fa-dice",
    slot: "fa-gem",
    crash: "fa-rocket",
    table: "fa-chess-board",
    fishing: "fa-fish",
    arcade: "fa-gamepad",
    lottery: "fa-bowling-ball",
    promotion: "fa-ticket",
    leaderboard: "fa-trophy",
    sponsorship: "fa-handshake",
    download: "fa-download",
    affiliate: "fa-network-wired",
    contact: "fa-message",
    info: "fa-circle-info"
};

const providerSets = {
    sports: ["CRICKET", "SABA", "BTi", "SBO", "HORSE", "CMD", "PINNACLE"],
    casino: ["EVO", "SEXY", "PP", "DG", "HOTROAD", "PT", "VIA", "WINFINITY", "MG"],
    slot: ["JILI", "PG", "FC", "JDB", "SPRIBE", "CQ9", "Play8", "ACEWIN", "FUNKY", "NETENT", "HACKSAW", "RELAX", "YELLOWBAT", "RICH88", "KA"],
    crash: ["Aviator", "JILI", "SMARTSOFT", "JDB", "FC", "RICH88", "MG", "PP", "KM", "YL", "CQ9", "Joker", "KA", "RELAX", "CRASH88"],
    table: ["JILI", "MONOPOLY", "KM", "RICH88", "SPRIBE", "PT", "YL", "CQ9", "JDB", "INJOY", "KA", "NETENT", "PG", "SBO", "WORLDMATCH", "COOLGAME", "RELAX", "HACKSAW", "PP"],
    fishing: ["JILI", "JDB", "FC", "SG", "YELLOWBAT", "CQ9", "GTF", "JOKER", "KA", "Lucky365", "ACEWIN"],
    arcade: ["JILI", "JDB", "FC", "KM", "YL", "KA", "PG", "RICH88", "CG", "PP", "CQ9", "INJOY", "Lucky365", "NEXTSPIN", "RELAX", "HACKSAW", "MM"],
    lottery: ["JILI", "MONOPOLY", "KM", "YELLOWBAT", "CQ9", "JOKER", "PNG", "RICH88", "SABA", "HACKSAW"]
};

const primarySections = [
    { id: "home", label: "হোম", type: "link", icon: iconMap.home },
    { id: "hot", label: "হট গেম", type: "games", icon: iconMap.hot, providers: [] },
    { id: "sports", label: "স্পোর্ট", type: "providers", icon: iconMap.sports, providers: providerSets.sports },
    { id: "casino", label: "ক্যাসিনো", type: "providers", icon: iconMap.casino, providers: providerSets.casino },
    { id: "slot", label: "স্লট", type: "providers", icon: iconMap.slot, providers: providerSets.slot },
    { id: "crash", label: "ক্র্যাশ", type: "providers", icon: iconMap.crash, providers: providerSets.crash },
    { id: "table", label: "টেবিল", type: "providers", icon: iconMap.table, providers: providerSets.table },
    { id: "fishing", label: "ফিশিং", type: "providers", icon: iconMap.fishing, providers: providerSets.fishing },
    { id: "arcade", label: "আর্কেড", type: "providers", icon: iconMap.arcade, providers: providerSets.arcade },
    { id: "lottery", label: "লটারি", type: "providers", icon: iconMap.lottery, providers: providerSets.lottery }
];

const utilitySections = [
    { id: "promotion", label: "প্রমোশন", icon: iconMap.promotion },
    { id: "leaderboard", label: "বিজয়ীদের তালিকা", icon: iconMap.leaderboard },
    { id: "sponsorship", label: "স্পনসরশিপ", icon: iconMap.sponsorship },
    { id: "download", label: "ডাউনলোড", icon: iconMap.download },
    { id: "affiliate", label: "দায়িত্বশীল গেমিং", icon: iconMap.affiliate },
    { id: "contact", label: "যোগাযোগ করুন", icon: iconMap.contact, providers: ["Live Chat"] },
    { id: "about", label: "আমাদের সম্পর্কে", icon: iconMap.info },
    { id: "rules", label: "সচরাচর জিজ্ঞাসা", icon: "fa-question-circle" }
];

const topCategories = primarySections.filter((item) => !["home"].includes(item.id));

const gameNames = [
    "HEYVIP Super Ace", "Fortune Gems Legend", "Golden Idol", "Revolver Hare",
    "HEYVIP Gates of Super", "Fortune Garuda 500", "Super Ace", "Fortune Gems 500",
    "Super Ace Deluxe", "Boxing King", "Fortune Gems 3", "Fortune Gems 2",
    "Fortune Gems", "Money Coming", "HEYVIP Super Element", "HEYVIP Pirate Legend",
    "Match Odds", "Aviator", "Crazy Time", "Sexy Baccarat", "HEYVIP Crash",
    "Wild Bounty Showdown", "Magic Ace Wild Lock", "Aztec Gems", "High Flyer", "Mega Wheel"
];

const categoryCycle = ["hot", "slot", "casino", "crash", "table", "arcade", "fishing", "lottery"];
const providerCycle = ["JILI", "HEYVIP", "PG", "EVO", "PP", "FC", "CQ9", "RICH88"];
const colors = ["#f6b51d", "#e64835", "#0f7ad6", "#2aa85c", "#7d4de2", "#d98116", "#1262c4", "#c82654"];

const games = gameNames.map((name, index) => ({
    id: index + 1,
    name,
    category: index < 26 ? "hot" : categoryCycle[index % categoryCycle.length],
    provider: providerCycle[index % providerCycle.length],
    badge: index < 8 ? "HOT" : index > 20 ? "NEW" : "",
    color: colors[index % colors.length],
    sort: index + 1
}));

const recommended = games.slice(0, 12).map((game, index) => ({
    ...game,
    color: colors[(index + 2) % colors.length],
    tag: index % 3 === 0 ? "CX" : "HV"
}));

const promotions = [
    { id: 1, title: "ডাউনলোড করুন", subtitle: "১.১.১.১ WARP", color: "#056c2f" },
    { id: 2, title: "ইন্ডিয়ান প্রিমিয়ার লীগ", subtitle: "SRH VS RR", color: "#063f79" },
    { id: 3, title: "ভারত বনাম ইংল্যান্ড", subtitle: "ENGLAND WOMEN VS INDIA WOMEN", color: "#0b8f53" },
    { id: 4, title: "আয়ারল্যান্ড ত্রিদেশীয়", subtitle: "PAK vs IRE vs WI", color: "#09603a" }
];

const sports = [
    { id: 101, league: "বাংলাদেশ প্রিমিয়ার", teamA: "ঢাকা কিংস", teamB: "চট্টগ্রাম টাইগার্স", time: "লাইভ", odds: [1.86, 3.25, 2.12] },
    { id: 102, league: "ইন্ডিয়া টি-২০", teamA: "মুম্বাই", teamB: "কলকাতা", time: "20:30", odds: [1.72, 3.45, 2.28] },
    { id: 103, league: "ইংলিশ লীগ", teamA: "লন্ডন ব্লু", teamB: "মার্সি রেড", time: "22:00", odds: [2.05, 3.10, 1.94] }
];

router.get("/home", async (req, res) => {
    if (playerHomeCache.value && Date.now() < playerHomeCache.expiresAt) {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        res.setHeader("X-Player-Home-Cache", "HIT");
        return success(res, playerHomeCache.value);
    }
    if (playerHomeCache.value && Date.now() < playerHomeCache.staleAt) {
        res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
        res.setHeader("X-Player-Home-Cache", "STALE");
        return success(res, playerHomeCache.value);
    }

    const [branding, banners, cmsGames, notice] = await Promise.all([
        getWebsiteSetting("branding"),
        getWebsiteSetting("banners"),
        getWebsiteSetting("games"),
        getWebsiteSetting("notice")
    ]);
    const activeBanners = Array.isArray(banners) ? banners : [];
    let activeCmsGames = Array.isArray(cmsGames) ? cmsGames.filter((game) => game && game.active !== false) : [];
    let activeProviderGames = [];
    let providerError = null;
    let providerConfigured = false;
    let providerTotal = 0;
    try {
        const providerResult = await fetchProviderGames();
        activeProviderGames = providerResult.games || [];
        providerConfigured = !!providerResult.configured;
        providerTotal = Number(providerResult.total || activeProviderGames.length || 0);
        providerError = providerResult.error || null;
    } catch (err) {
        providerConfigured = true;
        providerError = {
            message: err.message || "Game API failed",
            status: err.status || 502,
            code: err.code || "GAME_PROVIDER_ERROR"
        };
    }
    const sourceGames = activeProviderGames.length ? activeProviderGames : activeCmsGames;
    const playerBrand = { name: branding?.siteName || "MARBELBET", language: "Bangla", currency: "BDT", logoUrl: branding?.logoUrl || "" };
    const playerNotice = notice?.active ? notice.text : "Marbelbet Bkash Deposit 10% Bonus today only!";
    const playerBanners = activeBanners.map((banner, index) => ({
        id: banner.id || index + 1,
        title: banner.title || banner.name || "Promotion",
        subtitle: banner.subtitle || "",
        imageUrl: banner.imageUrl || banner.image || banner.url || "",
        cta: banner.cta || "Show Details",
        accent: banner.accent || "#0fe2ff"
    }));
    const playerGames = sourceGames.map((game, index) => ({
        id: pickFirst(game.id, game.gameId, game.game_id, game.gameUid, game.game_uid, game.uid, index + 1),
        name: pickFirst(game.name, game.title, game.game_name, game.gameName, `Game ${index + 1}`),
        gameUid: pickFirst(game.gameUid, game.game_uid, game.uid, game.game_code, game.code, game.id, ""),
        category: normalizeCategory(pickFirst(game.category, game.type, game.game_type, "slot")),
        provider: String(pickFirst(game.provider, game.provider_id, game.providerId, game.brand_name, "BETX")).toUpperCase(),
        providerId: pickFirst(game.providerId, game.provider_id, game.brand_id, ""),
        badge: game.badge || "HOT",
        imageUrl: absoluteProviderAsset(pickFirst(game.imageUrl, game.image_url, game.image, pickProviderImage(game)), process.env.HIGHAPI_BASE_URL || ""),
        providerLogoUrl: game.providerLogoUrl || "",
        color: game.color || colors[index % colors.length],
        sort: game.sortOrder || index + 1
    }));
    const payload = {
        brand: { name: "CRICKEX", language: "বাংলা", currency: "BDT" },
        actions: { signup: "সাইন আপ", login: "লগ ইন" },
        sectionTitles: {
            games: "হট গেম",
            promotions: "প্রিয়",
            recommended: "অনলাইন গেমগুলি",
            sports: "লাইভ স্পোর্টস",
            payments: "দ্রুত পেমেন্ট পদ্ধতি",
            social: "কমিউনিটি যোগাযোগ"
        },
        sidePromo: {
            title: "২০২৬ সেশন লিডারবোর্ড",
            amount: "৳0,000,000",
            time: "রাত ৯টা - ৭টা"
        },
        sidebar: { primary: primarySections, utility: utilitySections },
        topCategories,
        heroBanners: [
            {
                id: 1,
                title: "১ নং ট্রেডিং ব্র্যান্ড",
                subtitle: "HEYVIP-তে",
                cta: "JeetWin",
                person: "ambassador",
                accent: "#0fe2ff"
            },
            {
                id: 2,
                title: "আইফোন ১৭ প্রো ম্যাক্স",
                subtitle: "বিজয়ী: ১৫ মে, ২০২৬",
                cta: "আরও দেখুন",
                person: "host",
                accent: "#33ff74"
            }
        ],
        ticker: "বাংলাদেশের সবচেয়ে বিশ্বস্ত ক্রিকেট ট্রেডিং ও অনলাইন ক্যাসিনো প্ল্যাটফর্ম। স্মার্ট ভাবে বেট করুন, নিরাপদে খেলুন এবং দ্রুত পেমেন্ট উপভোগ করুন।",
        games,
        recommended,
        promotions,
        sports,
        payments: ["bKash", "Nagad", "Rocket", "UPay", "iPay", "SureCash", "Bank"],
        social: ["Facebook", "Telegram", "YouTube", "WhatsApp", "Instagram"],
        brand: playerBrand,
        notice: playerNotice,
        providers: ["BTI", "CMD", "DPSPORTS", "LUCKYSPORT", "SBO", "TF", "UNITEDGAMING"],
        heroBanners: playerBanners.length ? playerBanners : [
            {
                id: 1,
                title: "Bkash Deposit 10% Bonus",
                subtitle: "Today only",
                imageUrl: "",
                cta: "Show Details",
                accent: "#0fe2ff"
            }
        ],
        games: playerGames.length ? playerGames : (providerConfigured ? [] : games),
        gameApi: {
            configured: providerConfigured,
            error: providerError,
            total: providerTotal,
            visible: playerGames.length
        },
        promotions: playerBanners.length ? playerBanners : promotions,
        updatedAt: new Date().toISOString()
    };

    playerHomeCache.value = payload;
    playerHomeCache.expiresAt = Date.now() + cacheMs("PLAYER_HOME_CACHE_MS", 60 * 1000);
    playerHomeCache.staleAt = Date.now() + cacheMs("PLAYER_HOME_STALE_MS", 5 * 60 * 1000);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.setHeader("X-Player-Home-Cache", "MISS");
    return success(res, payload);
});

router.get("/game-api-status", async (req, res) => {
    const cfg = await getHighApiConfig();
    if (!cfg.enabled || !cfg.baseUrl || !cfg.xApiKey) {
        return success(res, {
            configured: false,
            provider: cfg.provider,
            baseUrl: cfg.baseUrl || "",
            gamesPath: cfg.gamesPath || "",
            message: "Game API key or base URL missing"
        });
    }

    const url = `${cfg.baseUrl.replace(/\/$/, "")}${cfg.gamesPath || "/api/v1/games.php"}`;
    try {
        const response = await fetchWithTimeout(url, { headers: providerRequestHeaders(cfg) });
        const data = await response.json().catch(() => null);
        const rows = extractProviderGameRows(data || {});
        const providerMap = extractProviderBrands(data || {});
        const providerError = data && providerStatusFailed(data);
        return success(res, {
            configured: true,
            provider: cfg.provider,
            baseUrl: cfg.baseUrl,
            gamesPath: cfg.gamesPath,
            httpStatus: response.status,
            ok: response.ok && !providerError,
            count: rows.length,
            total: extractProviderTotal(data || {}),
            providerMessage: data?.message || "",
            providerCode: data?.code || data?.status || "",
            needsProviderIpWhitelist: /ip .*not authorized/i.test(data?.message || ""),
            sample: rows.slice(0, 3).map((game, index) => normalizeProviderGame(game, index, cfg.baseUrl, providerMap))
        });
    } catch (err) {
        return error(res, `Game API connection failed: ${err.message}`, 502, "GAME_API_FAILED");
    }
});

router.post("/game-launch", authenticate, async (req, res) => {
    const { gameId, gameUid } = req.body || {};
    const cmsGames = await getWebsiteSetting("games");
    const activeCmsGames = Array.isArray(cmsGames) ? cmsGames.filter((item) => item && item.active !== false) : [];
    const providerResult = await fetchProviderGames().catch(() => ({ games: [] }));
    const providerGames = Array.isArray(providerResult.games) ? providerResult.games : [];
    const sourceGames = providerGames.length ? providerGames : activeCmsGames;
    const allGames = sourceGames.length ? sourceGames.map((item, index) => ({
        ...normalizeProviderGame(item.raw || item, index),
        ...item,
        category: normalizeCategory(item.category),
        provider: String(item.provider || "BETX").toUpperCase()
    })) : games;
    const game = allGames.find((item) => String(item.id) === String(gameId) || (gameUid && String(item.gameUid) === String(gameUid)));
    if (!game) return error(res, "Game not found", 404);

    const apiConfig = await getHighApiConfig();
    if (apiConfig.enabled && apiConfig.baseUrl && apiConfig.xApiKey && apiConfig.secretKey) {
        const apiKey = apiConfig.xApiKey;
        const secretKey = apiConfig.secretKey;
        const launchEndpoint = `${apiConfig.baseUrl.replace(/\/$/, "")}${apiConfig.launchPath || "/api/v1/launch.php"}`;
        try {
            // Fetch wallet with lock to prevent race conditions
            const wallet = await Wallet.findOne({ 
                where: { userId: req.user.id },
                lock: true // Pessimistic locking
            });
            const host = `${req.protocol}://${req.get("host")}`;
            const callbackUrl = safeProviderCallbackUrl(apiConfig.callbackUrl, host);
            console.log(`[game-launch] userId=${req.user.id} game=${game.gameUid || game.id} callbackUrl=${callbackUrl} walletBalance=${wallet?.balance ?? "null (wallet not found!)"} host=${host}`);
            const playerId = String(req.user.id);
            const playerName = String(req.user.username || `player${req.user.id}`);
            const providerGameUid = String(game.gameUid || game.id);
            const walletBal = Number(wallet?.balance ?? 0);
            console.log(`[game-launch] walletBal=${walletBal} (raw wallet.balance=${wallet?.balance})`);
            cacheWallet(req.user.id, walletBal); // prime cache for first callback;
            // Full payload — all variants included; balance sent as string per HighAPI docs
            const payload = {
                player_id: playerId,
                player_uid: playerId,
                user_id: playerId,
                member_account: playerId,
                username: playerName,
                player_name: playerName,
                balance: String(walletBal),
                credit_amount: String(walletBal),
                game_uid: providerGameUid,
                game_code: providerGameUid,
                game_id: String(game.id),
                token: apiKey,
                timestamp: Date.now(),
                agency_uid: apiKey,
                return: apiConfig.returnUrl || host,
                return_url: apiConfig.returnUrl || host,
                home_url: apiConfig.returnUrl || host,
                callback: callbackUrl,
                callback_url: callbackUrl,
                currency_code: apiConfig.currencyCode || "BDT",
                currency: apiConfig.currencyCode || "BDT"
            };
            const encrypted = encryptLaunchPayload(payload, secretKey);
            const { response, data } = await launchProviderGame(launchEndpoint, apiKey, encrypted, apiConfig, payload);
            console.log(`[game-launch] HighAPI response status=${response.status} body=${JSON.stringify(data)}`);
            if (!response.ok) return error(res, data.message || "Provider launch failed", response.status, "GAME_PROVIDER_ERROR");
            if (providerStatusFailed(data)) return error(res, data.message || "Provider launch failed", data.code || 502, data.errorCode || "GAME_PROVIDER_ERROR");
            const launchUrl = pickFirst(
                data.launchUrl,
                data.launch_url,
                data.url,
                data.gameUrl,
                data.game_url,
                data.data?.launchUrl,
                data.data?.launch_url,
                data.data?.url,
                data.data?.gameUrl,
                data.data?.game_url
            );
            if (!launchUrl) return error(res, data.message || "Provider did not return a launch URL", 502, "GAME_PROVIDER_ERROR");

            return success(res, {
                gameId: game.id,
                gameName: game.name,
                mode: "live",
                provider: apiConfig.provider || game.provider,
                launchUrl,
                sessionId: data.sessionId || data.token || `live-${Date.now()}-${game.id}`,
                raw: data
            }, "Live game session created");
        } catch (err) {
            return error(res, `Provider API failed: ${err.message}`, 502, "GAME_PROVIDER_UNAVAILABLE");
        }
    }

    return success(res, {
        gameId: game.id,
        gameName: game.name,
        mode: "demo",
        launchUrl: "",
        sessionId: `demo-${Date.now()}-${game.id}`
    }, "Demo game session created");
});

router.post("/game-spin", authenticate, async (req, res) => {
    let reserved = null;
    try {
        const { gameId, gameUid, sessionId } = req.body || {};
        const spinReference = pickFirst(req.body?.spinReference, req.body?.referenceId, req.headers["idempotency-key"]);
        const stake = Number(req.body?.stake);
        if (!Number.isFinite(stake) || stake <= 0) {
            return error(res, "Invalid spin amount", 400, "INVALID_STAKE");
        }
        const normalizedStake = Number(stake.toFixed(2));
        const referenceId = `spin:${sessionId || "local"}:${spinReference || `${Date.now()}-${crypto.randomUUID()}`}`;
        reserved = await reserveGameTransaction({
            userId: req.user.id,
            referenceId,
            referenceType: "GAME_SPIN",
            description: `Game spin ${gameUid || gameId || ""}`
        });
        if (reserved.duplicate) {
            const previous = reserved.transaction;
            if (previous.status === "PENDING") {
                return error(res, "Spin is already being processed", 409, "DUPLICATE_SPIN_PENDING");
            }
            if (previous.status === "FAILED") {
                return error(res, previous.description || "Previous spin failed", 409, "DUPLICATE_SPIN_FAILED");
            }
            return success(res, {
                gameId: previous.gameId || gameId,
                gameUid: previous.gameUid || gameUid,
                stake: Number(previous.stake || normalizedStake),
                winAmount: Number(previous.winAmount || Math.max(0, Number(previous.amount || 0) + normalizedStake)),
                balance: Number(previous.balanceAfter || 0),
                reels: previous.reels || ["7", "7", "7"],
                transactionId: previous.id,
                duplicate: true
            }, previous.winAmount > 0 ? `You won ${previous.winAmount}` : "Spin already settled");
        }
        
        // Get wallet and check balance
        let wallet = await Wallet.findOne({ where: { userId: req.user.id } });
        if (!wallet) {
            // Auto-create wallet, seeding balance from User record
            const userRow = await User.findByPk(req.user.id);
            const seedBalance = Number(userRow?.balance || 0);
            wallet = await Wallet.create({ userId: req.user.id, balance: seedBalance });
        }

        // Sync wallet balance from User.balance if wallet is behind.
        // This fixes the case where deposits went to User.balance but not to Wallet.balance.
        const userRow = await User.findByPk(req.user.id);
        const userBalance = Number(userRow?.balance || 0);
        const walletBalance = Number(wallet.balance || 0);
        if (userBalance > walletBalance) {
            try {
                const wc = await Wallet.collection();
                await wc.updateMany(
                    { userId: { $in: [Number(req.user.id), String(req.user.id)] } },
                    { $set: { balance: userBalance, updatedAt: new Date() } }
                );
                wallet.balance = userBalance;
            } catch {
                wallet.balance = userBalance;
            }
        }

        if (Number(wallet.balance || 0) < normalizedStake) {
            await markGameTransactionFailed(reserved.transaction, "Insufficient balance");
            return error(res, "Insufficient balance. Please deposit to continue.", 402, "INSUFFICIENT_BALANCE");
        }

        // Calculate game result
        const reelsPool = ["7", "BAR", "10", "K", "Q", "A"];
        const reels = Array.from({ length: 3 }, () => reelsPool[Math.floor(Math.random() * reelsPool.length)]);
        const isWin = reels.every((reel) => reel === reels[0]) || Math.random() < 0.22;
        const winAmount = isWin ? Number((normalizedStake * (reels.every((reel) => reel === reels[0]) ? 5 : 2)).toFixed(2)) : 0;
        const settlement = await applyWalletSettlement({
            wallet,
            userId: req.user.id,
            bet: normalizedStake,
            win: winAmount
        });
        if (!settlement.ok) {
            await markGameTransactionFailed(reserved.transaction, "Insufficient balance");
            return error(res, "Your balance is none", 402, "INSUFFICIENT_BALANCE");
        }

        reserved.transaction.amount = settlement.netAmount;
        reserved.transaction.balanceBefore = settlement.before;
        reserved.transaction.balanceAfter = settlement.after;
        reserved.transaction.status = "COMPLETED";
        reserved.transaction.gameId = gameId;
        reserved.transaction.gameUid = gameUid;
        reserved.transaction.stake = normalizedStake;
        reserved.transaction.winAmount = winAmount;
        reserved.transaction.reels = reels;
        await reserved.transaction.save().catch(() => null);

        return success(res, {
            gameId,
            gameUid,
            stake: normalizedStake,
            winAmount,
            balance: Number(settlement.after || 0),
            reels,
            transactionId: reserved.transaction?.id
        }, winAmount > 0 ? `You won ${winAmount}` : "No win this spin");
    } catch (err) {
        await markGameTransactionFailed(reserved?.transaction, err.message || "Spin failed");
        return error(res, err.message || "Spin failed", 500);
    }
});

router.all("/game-callback", async (req, res) => {
    console.log(`[game-callback RAW] method=${req.method} body=${JSON.stringify(req.body)} query=${JSON.stringify(req.query)}`);

    let debugEntry = null;
    let processedTransaction = null;
    let settlementTransaction = null;
    try {
        const payload = await normalizeCallbackPayload(req);
        const { callbackUserRef, username, playerId, externalId } = normalizeUserLookupFields(payload);
        const transactionId = pickFirst(
            payload.transaction_id,
            payload.transactionId,
            payload.txn_id,
            payload.txnId,
            payload.trans_id,
            payload.transId,
            payload.reference_id,
            payload.referenceId,
            payload.reference,
            payload.bet_id,
            payload.betId,
            payload.game_transaction_id,
            payload.gameTransactionId,
            payload.id
        );

        const expectedSecret = process.env.HIGHAPI_CALLBACK_SECRET || "";
        if (expectedSecret) {
            const suppliedSecret = req.headers["x-callback-secret"] || req.query.secret || payload.secret || payload.callback_secret || "";
            const expected = Buffer.from(String(expectedSecret));
            const supplied = Buffer.from(String(suppliedSecret));
            if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
                const reason = callbackErrorReason("Invalid callback signature", {
                    expected: "present",
                    supplied: suppliedSecret ? "present" : "missing"
                });
                debugEntry = buildCallbackDebugEntry(req, payload, { callbackUserRef, username, playerId, externalId, transactionId });
                await appendCallbackIssue(debugEntry, { status: 401, message: reason });
                return res.status(401).json({ success: false, message: reason, errorCode: "INVALID_SIGNATURE" });
            }
        }

        const inferred = inferCallbackAmounts(payload);
        const settlementType = inferred.settlementType;
        // Log raw payload so we can see exactly what the provider sends
        console.log(`[game-callback RAW] settlementType=${settlementType} payload_keys=${Object.keys(payload).join(",")} inferred_bet=${inferred.bet} inferred_win=${inferred.win} inferred_refund=${inferred.refund} action=${payload.action||payload.type||payload.event||"?"} amount=${payload.amount} bet_amount=${payload.bet_amount||payload.betAmount} win_amount=${payload.win_amount||payload.winAmount} credit_amount=${payload.credit_amount||payload.creditAmount} debit_amount=${payload.debit_amount||payload.debitAmount}`);
        const gameUid = pickFirst(payload.game_uid, payload.gameUid, payload.game_id, payload.gameId, payload.game_code, payload.gameCode);
        const gameRound = pickFirst(payload.game_round, payload.gameRound, payload.round_id, payload.roundId, payload.round, payload.gameRoundId);
        const roundId = pickFirst(payload.round_id, payload.roundId, payload.round_identifier, payload.roundIdentifier);
        const timestamp = pickFirst(payload.timestamp, payload.time, payload.created_at, payload.createdAt);
        const bet = settlementType === "balance" || settlementType === "refund" ? 0 : normalizeMoney(inferred.bet);
        const win = settlementType === "balance" || settlementType === "debit" || settlementType === "refund" ? 0 : normalizeMoney(inferred.win);
        const refund = settlementType === "refund" || settlementType === "settle" ? normalizeMoney(inferred.refund) : 0;
        const callbackLookup = callbackUserRef || username || playerId || externalId;
        debugEntry = buildCallbackDebugEntry(req, payload, {
            callbackUserRef,
            username,
            playerId,
            externalId,
            settlementType,
            bet,
            win,
            refund,
            transactionId,
            gameUid,
            gameRound,
            roundId,
            timestamp
        });

        const validationErrors = [];
        if (!callbackLookup) validationErrors.push("Missing username/playerId/externalId");
        if (!Number.isFinite(bet) || bet < 0) validationErrors.push("Invalid bet amount");
        if (!Number.isFinite(win) || win < 0) validationErrors.push("Invalid win amount");
        if (!Number.isFinite(refund) || refund < 0) validationErrors.push("Invalid refund amount");
        if (settlementType !== "balance" && !transactionId && !gameRound && !roundId) validationErrors.push("Missing transactionId");

        if (validationErrors.length) {
            const reason = callbackErrorReason("Invalid callback payload", {
                errors: validationErrors.join("; "),
                callbackUserRef,
                username,
                playerId,
                externalId
            });
            await appendCallbackIssue(debugEntry, { status: 400, message: reason }, { validationErrors });
            return res.status(400).json({ success: false, message: reason, errorCode: "INVALID_CALLBACK_PAYLOAD" });
        }

        const user = await findUserByCallbackRef({ callbackUserRef, username, playerId, externalId });
        if (!user) {
            const reason = callbackErrorReason("User not found", { callbackUserRef, username, playerId, externalId, transactionId });
            await appendCallbackIssue(debugEntry, { status: 404, message: reason });
            return res.status(404).json({ success: false, message: reason, errorCode: "USER_NOT_FOUND" });
        }

        const wallet = await ensureWalletForUser(user.id);
        if (!wallet) {
            const reason = callbackErrorReason("Wallet not found", { userId: user.id, username: user.username });
            await appendCallbackIssue(debugEntry, { status: 404, message: reason }, { resolvedUserId: user.id });
            return res.status(404).json({ success: false, message: reason, errorCode: "WALLET_NOT_FOUND" });
        }

        // Sync: use User.balance when it's higher than wallet.balance.
        // On Vercel the startup normalizer doesn't run, so wallet.balance can lag behind User.balance.
        try {
            const userRow = await User.findByPk(Number(user.id));
            const userBal   = Number(userRow?.balance || 0);
            const walletBal = Number(wallet.balance   || 0);
            if (userBal > walletBal) {
                wallet.balance = userBal;
                const wc = await Wallet.collection();
                await wc.updateMany(
                    { userId: { $in: [Number(user.id), String(user.id)] } },
                    { $set: { balance: userBal, updatedAt: new Date() } }
                );
            }
        } catch {}

        const balanceBefore = Number(wallet.balance || 0);
        // IMPORTANT: timestamp is intentionally excluded from referenceId.
        // HighAPI retries failed callbacks with a new timestamp each time.
        // Including timestamp would treat every retry as a new transaction,
        // draining the player's balance on each retry. gameRound/transactionId
        // are stable across retries and are sufficient for dedup.
        const referenceId = stableReferenceId(
            settlementType || "settle",
            transactionId ? `tx:${transactionId}` : "",
            gameUid ? `game:${gameUid}` : "",
            gameRound ? `gameRound:${gameRound}` : "",
            roundId ? `roundId:${roundId}` : "",
            `${callbackLookup}`
        );

        if (settlementType === "balance") {
            // Return the player's ACTUAL current balance.
            // Cached balance is preferred (instant); fall back to balanceBefore from the DB wallet.
            // Returning 0 here would cause the game to display 0 after every spin.
            const balanceVal = Number((getCachedBalance(user.id) ?? balanceBefore).toFixed(2));
            const responseBody = {
                status: 1,
                errCode: 0,
                error_code: 0,
                credit_amount: balanceVal,
                balance: balanceVal,
                current_balance: balanceVal,
                player_balance: balanceVal,
                available_balance: balanceVal,
                timestamp: Math.floor(Date.now() / 1000)
            };
            console.log(`[game-callback] balance-check response userId=${user.id} balance=${balanceVal}`);
            res.json(responseBody);
            appendCallbackIssue(debugEntry, { status: 200, body: responseBody }, { resolvedUserId: user.id, balanceBefore, balanceAfter: balanceBefore }).catch(() => null);
            return;
        }

        const delta = Number((win + refund - bet).toFixed(2));

        // Use cached balance for instant response; fall back to DB if cache miss
        let before = getCachedBalance(user.id);
        let freshWallet = null;
        if (before === null) {
            freshWallet = await Wallet.findOne({ where: { userId: user.id } });
            if (!freshWallet) throw new Error("Wallet not found for balance update");
            before = Number(Number(freshWallet.balance || 0).toFixed(2));
        }
        const after = Number((before + delta).toFixed(2));

        if (after < 0) {
            const responseBody = { status: 0, errCode: 1, error_code: 1, credit_amount: before, balance: before, current_balance: before, timestamp: Math.floor(Date.now() / 1000) };
            await appendCallbackIssue(debugEntry, { status: 402, body: responseBody }, { resolvedUserId: user.id, balanceBefore: before, balanceAfter: before });
            return res.status(402).json(responseBody);
        }

        // Update cache immediately so next callback sees the new balance
        cacheWallet(user.id, after);

        // credit_amount in HighAPI seamless-wallet settle response = player's CURRENT balance after the transaction.
        // (NOT the net deduction — that interpretation caused balance to show 0 whenever win >= bet.)
        const responseBody = {
            status: 1,
            errCode: 0,
            error_code: 0,
            credit_amount: after,
            balance: after,
            current_balance: after,
            player_balance: after,
            available_balance: after,
            timestamp: Math.floor(Date.now() / 1000)
        };
        console.log(`[game-callback] FAST response credit_amount=${after} balance=${after} bet=${bet} win=${win} before=${before} after=${after} settlementType=${settlementType}`);
        res.json(responseBody);

        // === BACKGROUND DB WRITES (fire-and-forget) ===
        const transactionType = delta >= 0 ? "BET_WON" : "GAME_SETTLEMENT";
        const description = `Game ${gameUid || ""} ${settlementType || "settle"} round ${gameRound || ""}`.trim();
        const uid = Number(user.id);
        const uidStr = String(user.id);

        // eslint-disable-next-line no-inner-declarations
        async function backgroundSettle() {
            try {
                // Idempotency check first
                const existingTxn = await Transaction.findOne({ where: { userId: user.id, referenceId } }).catch(() => null);
                if (existingTxn?.status === "COMPLETED") {
                    console.log(`[game-callback BG] duplicate skipped referenceId=${referenceId}`);
                    return;
                }

                // Write wallet balance
                try {
                    const walletCol = await Wallet.collection();
                    await walletCol.updateMany(
                        { userId: { $in: [uid, uidStr] } },
                        { $set: { balance: after, updatedAt: new Date() } }
                    );
                } catch (writeErr) {
                    const fw = freshWallet || await Wallet.findOne({ where: { userId: user.id } }).catch(() => null);
                    if (fw?._id) {
                        const walletCol = await Wallet.collection();
                        await walletCol.updateOne({ _id: fw._id }, { $set: { balance: after, updatedAt: new Date() } });
                    } else {
                        throw writeErr;
                    }
                }

                // Sync User.balance
                try {
                    const userCol = await User.collection();
                    await userCol.updateMany({ id: { $in: [uid, uidStr] } }, { $set: { balance: after, updatedAt: new Date() } });
                } catch {}

                // Upsert ledger entry
                try {
                    const [row, created] = await Transaction.findOrCreate({
                        where: { userId: user.id, referenceId },
                        defaults: { userId: user.id, type: transactionType, amount: Math.abs(delta), balanceBefore: before, balanceAfter: after, status: "COMPLETED", description, referenceId, referenceType: "GAME_CALLBACK" }
                    });
                    if (!created) {
                        row.amount = Math.abs(delta); row.balanceBefore = before; row.balanceAfter = after;
                        row.status = "COMPLETED"; if (description) row.description = description;
                        row.referenceType = "GAME_CALLBACK";
                        await row.save();
                    }
                    processedTransaction = row;
                } catch (txErr) {
                    console.error("[game-callback BG] Ledger write failed:", txErr.message);
                }

                console.log(`[game-callback BG] settled userId=${user.id} before=${before} after=${after}`);
                await appendCallbackIssue(debugEntry, { status: 200, body: responseBody }, { resolvedUserId: user.id, balanceBefore: before, balanceAfter: after }).catch(() => null);
            } catch (bgErr) {
                console.error("[game-callback BG] Background settle failed:", bgErr.message);
            }
        }
        // Await so Vercel serverless doesn't terminate before DB writes finish
        await backgroundSettle();
        return;
    } catch (err) {
        const reason = callbackErrorReason("Callback failed", { error: err.message });
        await appendCallbackIssue(debugEntry || buildCallbackDebugEntry(req, {}, {}), { status: 500, message: reason }, {
            transactionId: processedTransaction?.id || settlementTransaction?.id || null
        });
        return res.status(500).json({ success: false, message: reason, errorCode: "CALLBACK_FAILED" });
    }
});

router.all("/game-return", (req, res) => {
    const fallbackUrl = process.env.FRONTEND_PLAYER_URL || process.env.FRONTEND_BASE_URL || "";
    const requestedUrl = pickFirst(req.query.return_to, req.query.redirect, req.query.url, fallbackUrl);

    // Build allowed-domain whitelist from env + fallback URL
    const allowedDomains = (process.env.GAME_RETURN_ALLOWED_DOMAINS || "").split(",").map(d => d.trim().toLowerCase()).filter(Boolean);
    if (fallbackUrl) {
        try { allowedDomains.push(new URL(fallbackUrl).hostname.toLowerCase()); } catch {}
    }

    if (/^https?:\/\//i.test(String(requestedUrl))) {
        let targetHost = "";
        try { targetHost = new URL(requestedUrl).hostname.toLowerCase(); } catch {}
        // Reject open-redirect to unknown hosts
        if (allowedDomains.length > 0 && !allowedDomains.some(d => targetHost === d || targetHost.endsWith("." + d))) {
            return res.status(400).json({ success: false, message: "Redirect target not allowed", errorCode: "INVALID_REDIRECT" });
        }
        return res.redirect(302, requestedUrl);
    }
    return res.json({
        success: true,
        message: "Game session returned",
        timestamp: Date.now()
    });
});

router.all("/game-balance", async (req, res) => {
    console.log(`[game-balance RAW] method=${req.method} body=${JSON.stringify(req.body)} query=${JSON.stringify(req.query)}`);

    try {
        // Validate callback secret when HIGHAPI_CALLBACK_SECRET is set
        const expectedSecret = process.env.HIGHAPI_CALLBACK_SECRET || "";
        if (expectedSecret) {
            const suppliedSecret = req.headers["x-callback-secret"] || req.query.secret || "";
            const expected = Buffer.from(String(expectedSecret));
            const supplied = Buffer.from(String(suppliedSecret));
            if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
                return res.status(401).json({ success: false, message: "Invalid callback signature", errorCode: "INVALID_SIGNATURE" });
            }
        }

        const payload = await normalizeCallbackPayload(req);
        const { user, wallet, lookup, debug } = await resolveWalletContext(payload, req);
        if (!user || !wallet) {
            const reason = callbackErrorReason("Wallet lookup failed", {
                resolvedIdentifier: lookup?.resolvedIdentifier,
                resolvedValue: lookup?.resolvedValue
            });
            await logBalanceDebug({
                at: new Date().toISOString(),
                event: "balance_lookup_failed",
                payload,
                response: { status: 404, message: reason },
                debug
            });
            return res.status(404).json({
                success: false,
                message: reason,
                cash: 0,
                balance: 0,
                credit_amount: 0,
                errorCode: "WALLET_NOT_FOUND"
            });
        }

        const balance = Number(wallet.balance || 0);
        console.log(`[game-balance] userId=${user.id} username=${user.username} balance=${balance} walletId=${wallet.id} walletUserId=${wallet.userId}`);
        const responseBody = {
            success: true,
            status: 1,          // numeric 1 = success; many PHP aggregators reject boolean true
            errCode: 0,
            error_code: 0,
            cash: balance,
            balance,
            credit_amount: balance,
            current_balance: balance,
            available_balance: balance,
            userId: Number(user.id),
            username: user.username,
            playerId: payload.playerId || payload.player_id || String(user.id),
            externalId: payload.externalId || payload.external_id || String(user.id),
            sessionId: payload.sessionId || payload.session_id || null,
            token: payload.token || null,
            timestamp: Date.now()
        };

        await logBalanceDebug({
            at: new Date().toISOString(),
            event: "balance_lookup_success",
            payload,
            debug: {
                ...debug,
                responseBalance: balance
            },
            response: responseBody
        });

        return res.json(responseBody);
    } catch (err) {
        const reason = callbackErrorReason("Balance lookup failed", { error: err.message });
        await logBalanceDebug({
            at: new Date().toISOString(),
            event: "balance_lookup_error",
            payload: req.body || {},
            response: { status: 500, message: reason }
        });
        return res.status(500).json({ success: false, message: reason, errorCode: "BALANCE_LOOKUP_FAILED" });
    }
});

router.get("/game-callback-debug", authenticate, authorize("BANKING:VIEW"), async (req, res) => {
    const logs = await getSetting("game_callback_debug");
    return success(res, Array.isArray(logs) ? logs : []);
});

// Temporary diagnostic endpoint — no auth
router.get("/callback-status", async (req, res) => {
    try {
        let arr = [];
        try {
            const raw = await getSetting("game_callback_debug");
            if (Array.isArray(raw)) arr = raw;
        } catch {}
        const recent = arr.slice(0, 10).map(e => ({
            at:             e?.at,
            settlementType: e?.parsed?.settlementType,
            userId:         e?.parsed?.callbackUserRef,
            bet:            e?.parsed?.bet,
            win:            e?.parsed?.win,
            status:         e?.response?.status,
            balance:        e?.response?.body?.balance ?? null,
            credit_amount:  e?.response?.body?.credit_amount ?? null,
            action:         e?.payload?.action || e?.payload?.type || null,
            rawKeys:        e?.payload ? Object.keys(e.payload).join(",") : null
        }));
        return res.json({ ok: true, total: arr.length, recent, serverTime: new Date().toISOString() });
    } catch (err) {
        return res.json({ ok: false, error: err.message, serverTime: new Date().toISOString() });
    }
});

// Debug endpoint: shows raw MongoDB wallet + user state for the authenticated player.
// Use this to diagnose balance discrepancies without needing direct DB access.
router.get("/wallet-debug", authenticate, async (req, res) => {
    try {
        const uid = req.user.id;
        const uidNum = Number(uid);
        const uidStr = String(uid);

        // Raw collection scan — bypasses adapter so we see the exact DB state
        const wc = await Wallet.collection();
        const uc = await User.collection();

        const [walletDocs, userDocs] = await Promise.all([
            wc.find({ userId: { $in: [uidNum, uidStr] } }).toArray(),
            uc.find({ id: { $in: [uidNum, uidStr] } }).toArray()
        ]);

        // Also try adapter findOne to see what the app code sees
        const adapterWallet = await Wallet.findOne({ where: { userId: uid } }).catch((err) => ({ _error: err.message }));
        const adapterUser   = await User.findByPk(uid).catch((err) => ({ _error: err.message }));

        return success(res, {
            queriedUserId: uid,
            rawWalletDocs: walletDocs.map((d) => ({ _id: String(d._id), id: d.id, userId: d.userId, balance: d.balance, updatedAt: d.updatedAt })),
            rawUserDocs:   userDocs.map((d)   => ({ _id: String(d._id), id: d.id, username: d.username, balance: d.balance, updatedAt: d.updatedAt })),
            adapterWallet: adapterWallet ? { id: adapterWallet.id, userId: adapterWallet.userId, balance: adapterWallet.balance } : null,
            adapterUser:   adapterUser   ? { id: adapterUser.id,   username: adapterUser.username,   balance: adapterUser.balance   } : null
        });
    } catch (err) {
        return error(res, err.message || "Debug failed", 500);
    }
});

router.get("/wallet", authenticate, async (req, res) => {
    try {
        const uid = req.user.id;
        const [wallet, userRow] = await Promise.all([
            Wallet.findOne({ where: { userId: uid } }),
            User.findByPk(uid)
        ]);

        const walletBal = Number(wallet?.balance || 0);
        const userBal   = Number(userRow?.balance || 0);
        const balance   = Math.max(walletBal, userBal);

        if (wallet && userBal > walletBal) {
            // updateMany covers any leftover duplicate documents
            Wallet.collection()
                .then(wc => wc.updateMany({ userId: { $in: [Number(uid), String(uid)] } }, { $set: { balance: userBal, updatedAt: new Date() } }))
                .catch(() => null);
        }

        return success(res, {
            balance,
            frozenBalance:  Number(wallet?.frozenBalance  || 0),
            totalDeposit:   Number(wallet?.totalDeposit   || 0),
            totalWithdraw:  Number(wallet?.totalWithdraw  || 0)
        });
    } catch (err) {
        return error(res, err.message || "Failed to fetch wallet", 500);
    }
});

router.post("/wallet", authenticate, async (req, res) => {
    try {
        const uid = req.user.id;
        const [wallet, userRow] = await Promise.all([
            Wallet.findOne({ where: { userId: uid } }),
            User.findByPk(uid)
        ]);

        // Use the higher of wallet.balance and user.balance as source of truth.
        // This handles the case where deposits updated User.balance but not Wallet.balance.
        const walletBal = Number(wallet?.balance || 0);
        const userBal   = Number(userRow?.balance || 0);
        const balance   = Math.max(walletBal, userBal);

        // If they're out of sync, fix the wallet in the background
        if (wallet && userBal > walletBal) {
            // updateMany covers any leftover duplicate documents
            Wallet.collection()
                .then(wc => wc.updateMany({ userId: { $in: [Number(uid), String(uid)] } }, { $set: { balance: userBal, updatedAt: new Date() } }))
                .catch(() => null);
        }

        return success(res, {
            balance,
            frozenBalance:  Number(wallet?.frozenBalance  || 0),
            totalDeposit:   Number(wallet?.totalDeposit   || 0),
            totalWithdraw:  Number(wallet?.totalWithdraw  || 0)
        });
    } catch (err) {
        return error(res, err.message || "Failed to fetch wallet", 500);
    }
});

router.post("/bet-demo", (req, res) => {
    const { matchId, selection, odds, stake } = req.body || {};
    if (!matchId || !selection || !odds || !stake) return error(res, "Invalid bet slip", 400);

    return success(res, {
        ticketId: `PX-${Date.now()}`,
        matchId: Number(matchId),
        selection,
        odds: Number(odds),
        stake: Number(stake),
        potentialReturn: Number(stake) * Number(odds),
        status: "ACCEPTED_DEMO"
    }, "Demo bet accepted");
});

router.post("/register", async (req, res) => {
    try {
        const { username, password, fullName, phone, email, referralCode } = req.body || {};
        if (!username || !password) return error(res, "Username and password are required", 400);
        if (String(username).length < 4) return error(res, "Username must be at least 4 characters", 400);
        if (!/^(?=.*[A-Za-z])(?=.*\d).{6,20}$/.test(String(password))) {
            return error(res, "Password must be 6-20 characters with at least one letter and one number", 400);
        }

        const exists = await User.findOne({ where: { username } });
        if (exists) return error(res, "Username already exists", 409, "USERNAME_EXISTS");

        const user = await User.create({
            username,
            password: await bcrypt.hash(password, 10),
            role: "PLAYER",
            fullName: fullName || username,
            phone: phone || null,
            email: email || null,
            referralCode: `PX${Date.now().toString().slice(-7)}`,
            referredBy: referralCode || null,
            isActive: true,
            status: "active"
        });
        await Wallet.create({ userId: user.id, balance: 0 });

        const token = generateToken(user);
        await createSession(user.id, token, req.ip, req.headers["user-agent"]);

        return success(res, {
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                fullName: user.fullName,
                balance: 0
            }
        }, "Registration successful", 201);
    } catch (err) {
        return error(res, err.message || "Registration failed", 500);
    }
});

module.exports = router;
