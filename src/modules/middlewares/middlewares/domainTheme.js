// ডোমেইন অনুযায়ী সাইট কনফিগারেশন লোড করা
const db = require('../config/db');

const domainThemeMiddleware = async (req, res, next) => {
    const host = req.headers.host; // ভিজিটর কোন ডোমেইন থেকে আসছে
    const [siteConfig] = await db.execute('SELECT * FROM white_labels WHERE domain_name = ?', [host]);
    
    if (siteConfig.length > 0) {
        // সাইটের লোগো এবং কালার গ্লোবালি সেট করা
        req.siteTheme = {
            primaryColor: siteConfig[0].primary_color,
            logo: siteConfig[0].logo_url,
            title: siteConfig[0].site_title
        };
        next();
    } else {
        res.status(403).send("Domain not registered in Owner Panel!");
    }
};

module.exports = domainThemeMiddleware;