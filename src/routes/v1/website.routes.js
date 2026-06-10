const router = require("express").Router();
const { SystemSettings, WhiteLabel } = require("../../models");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { success, error } = require("../../utils/apiResponse");
const AuditLog = require("../../core/audit.engine");

// Helper
async function getWebsiteSetting(key) {
    const s = await SystemSettings.findOne({ where: { key, category: 'website' } });
    if (!s) return null;
    try { return JSON.parse(s.value); } catch { return s.value; }
}

async function setWebsiteSetting(key, value, userId) {
    const [s, created] = await SystemSettings.findOrCreate({
        where: { key },
        defaults: { value: JSON.stringify(value), category: 'website', updatedBy: userId }
    });
    if (!created) { s.value = JSON.stringify(value); s.updatedBy = userId; await s.save(); }
    return s;
}

const publicSiteConfigCache = {
    value: null,
    expiresAt: 0,
    staleAt: 0
};

function cacheMs(envKey, fallback) {
    const value = Number(process.env[envKey]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

// GET /api/v1/website/settings
router.get("/settings", authenticate, authorize('WEBSITE:VIEW'), asyncHandler(async (req, res) => {
    const settings = {
        siteName: await getWebsiteSetting('site_name') || 'BetX365',
        logo: await getWebsiteSetting('logo') || '',
        domainText: await getWebsiteSetting('domain_text') || '',
        notice: await getWebsiteSetting('notice') || '',
        maintenanceMode: await getWebsiteSetting('maintenance_mode') || false,
        theme: await getWebsiteSetting('theme') || { primaryColor: '#F7B112' }
    };
    return success(res, settings);
}));

// PATCH /api/v1/website/settings
router.patch("/settings", authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
    for (const [key, value] of Object.entries(req.body)) {
        await setWebsiteSetting(key, value, req.user.id);
    }
    publicSiteConfigCache.value = null;

    await AuditLog.create({
        userId: req.user.id, action: "WEBSITE_SETTINGS_UPDATED",
        description: `Updated: ${Object.keys(req.body).join(', ')}`, ipAddress: req.ip
    });

    return success(res, null, "Website settings updated");
}));

// GET /api/v1/website/all-settings
router.get("/all-settings", authenticate, authorize('WEBSITE:VIEW'), asyncHandler(async (req, res) => {
    const settings = await SystemSettings.findAll({
        where: { category: 'website' },
        order: [['key', 'ASC']]
    });

    const parsed = settings.map(s => ({
        key: s.key,
        value: (() => { try { return JSON.parse(s.value); } catch { return s.value; } })()
    }));

    return success(res, parsed);
}));

// PATCH /api/v1/website/all-settings
router.patch("/all-settings", authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
    for (const [key, value] of Object.entries(req.body)) {
        await setWebsiteSetting(key, value, req.user.id);
    }
    publicSiteConfigCache.value = null;
    return success(res, null, "All website settings updated");
}));

// GET /api/v1/website/banners
router.get("/banners", authenticate, asyncHandler(async (req, res) => {
    const banners = await getWebsiteSetting('banners') || [];
    return success(res, banners);
}));

// POST /api/v1/website/banners
router.post("/banners", authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
    const banners = await getWebsiteSetting('banners') || [];
    const newBanner = { id: Date.now(), ...req.body, createdAt: new Date() };
    banners.push(newBanner);
    await setWebsiteSetting('banners', banners, req.user.id);
    publicSiteConfigCache.value = null;
    return success(res, newBanner, "Banner added", 201);
}));

// DELETE /api/v1/website/banners/:id
router.delete("/banners/:id", authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
    const banners = await getWebsiteSetting('banners') || [];
    const filtered = banners.filter(b => String(b.id) !== req.params.id);
    await setWebsiteSetting('banners', filtered, req.user.id);
    publicSiteConfigCache.value = null;
    return success(res, null, "Banner deleted");
}));

// GET /api/v1/website/dashboard-images
router.get("/dashboard-images", authenticate, asyncHandler(async (req, res) => {
    const images = await getWebsiteSetting('dashboard_images') || [];
    return success(res, images);
}));

// POST /api/v1/website/dashboard-images
router.post("/dashboard-images", authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
    const images = await getWebsiteSetting('dashboard_images') || [];
    const newImage = { id: Date.now(), ...req.body, createdAt: new Date() };
    images.push(newImage);
    await setWebsiteSetting('dashboard_images', images, req.user.id);
    return success(res, newImage, "Dashboard image added", 201);
}));

// DELETE /api/v1/website/dashboard-images/:id
router.delete("/dashboard-images/:id", authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
    const images = await getWebsiteSetting('dashboard_images') || [];
    const filtered = images.filter(i => String(i.id) !== req.params.id);
    await setWebsiteSetting('dashboard_images', filtered, req.user.id);
    return success(res, null, "Dashboard image deleted");
}));

// ==================== WHITE LABEL / MULTI-TENANT ====================

// GET /api/v1/website/whitelabels
router.get("/whitelabels", authenticate, authorize('WHITELABEL:VIEW'), asyncHandler(async (req, res) => {
    const labels = await WhiteLabel.findAll({ order: [['createdAt', 'DESC']] });
    return success(res, labels);
}));

// POST /api/v1/website/whitelabels — with limit enforcement
router.post("/whitelabels", authenticate, authorize('WHITELABEL:CREATE'), asyncHandler(async (req, res) => {
    // Check limit
    const limitSetting = await getWebsiteSetting('whitelabel_limit') || 10;
    const currentCount = await WhiteLabel.count();
    if (currentCount >= limitSetting) {
        return error(res, `White-label limit reached (${limitSetting}). Increase limit first.`, 400, "WHITELABEL_LIMIT");
    }

    const { name, domain, logo, primaryColor, secondaryColor, isActive, currencyCode, commissionRate } = req.body;
    const label = await WhiteLabel.create({ name, domain, logo, primaryColor, secondaryColor, isActive, currencyCode, commissionRate, ownerId: req.user.id });

    const AuditLog = require("../../core/audit.engine");
    await AuditLog.create({
        userId: req.user.id, action: "WHITELABEL_CREATED",
        entity: "WhiteLabel", entityId: label.id,
        description: `Created white-label: ${label.name} (${label.domain || 'no domain'})`,
        ipAddress: req.ip
    });

    return success(res, label, "White label created", 201);
}));

// PATCH /api/v1/website/whitelabels/:id
router.patch("/whitelabels/:id", authenticate, authorize('WHITELABEL:EDIT'), asyncHandler(async (req, res) => {
    const label = await WhiteLabel.findByPk(req.params.id);
    if (!label) return error(res, "White label not found", 404);
    const { name, domain, logo, primaryColor, secondaryColor, isActive, currencyCode, commissionRate } = req.body;
    await label.update({ name, domain, logo, primaryColor, secondaryColor, isActive, currencyCode, commissionRate });
    return success(res, label, "White label updated");
}));

// GET /api/v1/website/whitelabel-limit
router.get("/whitelabel-limit", authenticate, authorize('WHITELABEL:VIEW'), asyncHandler(async (req, res) => {
    const limit = await getWebsiteSetting('whitelabel_limit') || 10;
    const current = await WhiteLabel.count();
    return success(res, { limit, current, remaining: limit - current });
}));

// PATCH /api/v1/website/whitelabel-limit
router.patch("/whitelabel-limit", authenticate, authorize('WHITELABEL:LIMIT'), asyncHandler(async (req, res) => {
    await setWebsiteSetting('whitelabel_limit', req.body.limit, req.user.id);
    return success(res, null, "White label limit updated");
}));

// ==================== CMS — BRANDING / THEME / DOMAINS / NOTICE ====================

// GET /api/v1/website/branding
router.get("/branding", authenticate, authorize('WEBSITE:VIEW'), asyncHandler(async (req, res) => {
    const branding = await getWebsiteSetting('branding') || { siteName: 'BetX365', tagline: '', logoUrl: '', faviconUrl: '' };
    return success(res, branding);
}));

// PATCH /api/v1/website/branding
router.patch("/branding", authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
    const cur = await getWebsiteSetting('branding') || {};
    const merged = { ...cur, ...req.body };
    await setWebsiteSetting('branding', merged, req.user.id);
    publicSiteConfigCache.value = null;
    await AuditLog.create({ userId: req.user.id, action: "WEBSITE_BRANDING_UPDATED", description: Object.keys(req.body).join(','), ipAddress: req.ip });
    return success(res, merged, "Branding updated");
}));

// GET /api/v1/website/theme
router.get("/theme", authenticate, authorize('WEBSITE:VIEW'), asyncHandler(async (req, res) => {
    const theme = await getWebsiteSetting('theme') || {
        primary: '#fbbf24', accent: '#22c55e', bg: '#0a0e1a', surface: '#1e293b',
        text: '#ffffff', success: '#22c55e', danger: '#ef4444'
    };
    return success(res, theme);
}));

// PATCH /api/v1/website/theme
router.patch("/theme", authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
    const cur = await getWebsiteSetting('theme') || {};
    const merged = { ...cur, ...req.body };
    await setWebsiteSetting('theme', merged, req.user.id);
    publicSiteConfigCache.value = null;
    await AuditLog.create({ userId: req.user.id, action: "WEBSITE_THEME_UPDATED", description: Object.keys(req.body).join(','), ipAddress: req.ip });
    return success(res, merged, "Theme updated");
}));

// GET /api/v1/website/notice
router.get("/notice", authenticate, authorize('WEBSITE:VIEW'), asyncHandler(async (req, res) => {
    const notice = await getWebsiteSetting('notice') || { text: '', active: false };
    return success(res, notice);
}));

// PATCH /api/v1/website/notice
router.patch("/notice", authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
    const cur = await getWebsiteSetting('notice') || {};
    const merged = { ...cur, ...req.body };
    await setWebsiteSetting('notice', merged, req.user.id);
    publicSiteConfigCache.value = null;
    await AuditLog.create({ userId: req.user.id, action: "WEBSITE_NOTICE_UPDATED", description: merged.text || '', ipAddress: req.ip });
    return success(res, merged, "Notice updated");
}));

// GET /api/v1/website/domains
router.get("/domains", authenticate, authorize('WEBSITE:VIEW'), asyncHandler(async (req, res) => {
    const domains = await getWebsiteSetting('domains') || [];
    return success(res, domains);
}));

// PATCH /api/v1/website/domains  (full replace)
router.patch("/domains", authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
    const list = Array.isArray(req.body.domains) ? req.body.domains : (Array.isArray(req.body) ? req.body : []);
    await setWebsiteSetting('domains', list, req.user.id);
    publicSiteConfigCache.value = null;
    await AuditLog.create({ userId: req.user.id, action: "WEBSITE_DOMAINS_UPDATED", description: `${list.length} domains`, ipAddress: req.ip });
    return success(res, list, "Domains updated");
}));

// ==================== CMS — COLLECTIONS (games / social-links / mobile-banners) ====================

function _collectionRoutes(routePath, settingsKey, auditAction) {
    router.get(routePath, authenticate, authorize('WEBSITE:VIEW'), asyncHandler(async (req, res) => {
        const items = await getWebsiteSetting(settingsKey) || [];
        return success(res, items);
    }));
    router.post(routePath, authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
        const items = await getWebsiteSetting(settingsKey) || [];
        const item = { id: Date.now(), sortOrder: items.length, active: true, createdAt: new Date(), ...req.body };
        items.push(item);
        await setWebsiteSetting(settingsKey, items, req.user.id);
        publicSiteConfigCache.value = null;
        await AuditLog.create({ userId: req.user.id, action: `${auditAction}_ADDED`, description: `id=${item.id}`, ipAddress: req.ip });
        return success(res, item, "Item added", 201);
    }));
    router.patch(`${routePath}/:id`, authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
        const items = await getWebsiteSetting(settingsKey) || [];
        const idx = items.findIndex(x => String(x.id) === req.params.id);
        if (idx === -1) return error(res, "Item not found", 404);
        items[idx] = { ...items[idx], ...req.body, id: items[idx].id };
        await setWebsiteSetting(settingsKey, items, req.user.id);
        publicSiteConfigCache.value = null;
        await AuditLog.create({ userId: req.user.id, action: `${auditAction}_UPDATED`, description: `id=${req.params.id}`, ipAddress: req.ip });
        return success(res, items[idx], "Item updated");
    }));
    router.delete(`${routePath}/:id`, authenticate, authorize('WEBSITE:UPDATE'), asyncHandler(async (req, res) => {
        const items = await getWebsiteSetting(settingsKey) || [];
        const filtered = items.filter(x => String(x.id) !== req.params.id);
        await setWebsiteSetting(settingsKey, filtered, req.user.id);
        publicSiteConfigCache.value = null;
        await AuditLog.create({ userId: req.user.id, action: `${auditAction}_DELETED`, description: `id=${req.params.id}`, ipAddress: req.ip });
        return success(res, null, "Item deleted");
    }));
}

_collectionRoutes('/games',           'games',                'WEBSITE_GAMES');
_collectionRoutes('/social-links',    'social_links',         'WEBSITE_SOCIAL');
_collectionRoutes('/mobile-banners',  'mobile_login_banners', 'WEBSITE_MOBILE_BANNER');

// ==================== PUBLIC SITE CONFIG (no auth) ====================

router.get("/public/site-config", asyncHandler(async (req, res) => {
    const now = Date.now();
    if (publicSiteConfigCache.value && now < publicSiteConfigCache.expiresAt) {
        res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        res.setHeader("X-Site-Config-Cache", "HIT");
        return success(res, publicSiteConfigCache.value);
    }
    if (publicSiteConfigCache.value && now < publicSiteConfigCache.staleAt) {
        res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
        res.setHeader("X-Site-Config-Cache", "STALE");
        return success(res, publicSiteConfigCache.value);
    }

    const [branding, theme, domains, banners, games, socialLinks, mobileLoginBanners, notice, maintenanceMode] = await Promise.all([
        getWebsiteSetting('branding'),
        getWebsiteSetting('theme'),
        getWebsiteSetting('domains'),
        getWebsiteSetting('banners'),
        getWebsiteSetting('games'),
        getWebsiteSetting('social_links'),
        getWebsiteSetting('mobile_login_banners'),
        getWebsiteSetting('notice'),
        getWebsiteSetting('maintenance_mode')
    ]);

    const allGames = Array.isArray(games) ? games : [];
    const activeGames = allGames.filter(g => g && g.active !== false);

    const payload = {
        branding: branding || { siteName: 'BetX365', tagline: '', logoUrl: '', faviconUrl: '' },
        theme: theme || {
            primary: '#fbbf24', accent: '#22c55e', bg: '#0a0e1a', surface: '#1e293b',
            text: '#ffffff', success: '#22c55e', danger: '#ef4444'
        },
        domains: Array.isArray(domains) ? domains : [],
        banners: Array.isArray(banners) ? banners : [],
        hero: Array.isArray(banners) && banners[0] ? banners[0] : null,
        games: activeGames,
        liveCasino: activeGames.filter(g => g.category === 'live'),
        socialLinks: Array.isArray(socialLinks) ? socialLinks : [],
        mobileLoginBanners: Array.isArray(mobileLoginBanners) ? mobileLoginBanners : [],
        notice: notice || { text: '', active: false },
        maintenanceMode: !!maintenanceMode
    };

    publicSiteConfigCache.value = payload;
    publicSiteConfigCache.expiresAt = Date.now() + cacheMs("PUBLIC_SITE_CONFIG_CACHE_MS", 60 * 1000);
    publicSiteConfigCache.staleAt = Date.now() + cacheMs("PUBLIC_SITE_CONFIG_STALE_MS", 5 * 60 * 1000);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.setHeader("X-Site-Config-Cache", "MISS");
    return success(res, payload);
}));

module.exports = router;
