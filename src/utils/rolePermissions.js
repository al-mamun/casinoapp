// Master role-permission configuration
// This is the single source of truth for what each role can access
const { normalizeRole } = require("./normalizeRole");

const rolePermissions = {
    OWNER: ['*'],
    MOTHER_PANEL: [
        'DOWNLINE:VIEW,CREATE,EDIT,DELETE,DEPOSIT,WITHDRAW',
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BETLIST:VIEW,REJECT,CANCEL',
        'RISK:VIEW,UPDATE',
        'BANKING:VIEW,DEPOSIT,WITHDRAW,TRANSFER,APPROVE',
        'BANKING_METHOD:VIEW,CREATE,EDIT,DELETE',
        'MATCH:VIEW,CREATE,EDIT,BLOCK,CONTROL',
        'RESULT:VIEW,DECLARE,HOLD,RELEASE,ROLLBACK',
        'SETTINGS:VIEW,UPDATE',
        'MESSAGE:VIEW,CREATE,EDIT,DELETE',
        'USER:VIEW,CREATE,EDIT,BLOCK,DELETE,RESTORE',
        'WEBSITE:VIEW,UPDATE',
        'PRIVILEGES:VIEW,UPDATE,CLONE',
        'SURVEILLANCE:VIEW,UPDATE',
        'COMPANY_PAYMENT:VIEW,SETTLE,PAYOUT',
        'WHITELABEL:VIEW,CREATE,EDIT'
    ],
    WHITE_LABEL: [
        'DOWNLINE:VIEW,CREATE,EDIT,DELETE,DEPOSIT,WITHDRAW',
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BETLIST:VIEW,REJECT,CANCEL',
        'RISK:VIEW,UPDATE',
        'BANKING:VIEW,DEPOSIT,WITHDRAW,TRANSFER,APPROVE',
        'BANKING_METHOD:VIEW,CREATE,EDIT,DELETE',
        'MATCH:VIEW,CREATE,EDIT,BLOCK,CONTROL',
        'RESULT:VIEW,DECLARE,HOLD,RELEASE,ROLLBACK',
        'SETTINGS:VIEW,UPDATE',
        'MESSAGE:VIEW,CREATE,EDIT,DELETE',
        'USER:VIEW,CREATE,EDIT,BLOCK,DELETE,RESTORE',
        'WEBSITE:VIEW,UPDATE',
        'PRIVILEGES:VIEW,UPDATE,CLONE',
        'SURVEILLANCE:VIEW,UPDATE',
        'COMPANY_PAYMENT:VIEW,SETTLE'
    ],
    SUPER_ADMIN: [
        'DOWNLINE:VIEW,CREATE,EDIT,DELETE,DEPOSIT,WITHDRAW',
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BETLIST:VIEW,REJECT,CANCEL',
        'RISK:VIEW,UPDATE',
        'BANKING:VIEW,DEPOSIT,WITHDRAW,TRANSFER,APPROVE',
        'BANKING_METHOD:VIEW,CREATE,EDIT,DELETE',
        'MATCH:VIEW,CREATE,EDIT,BLOCK,CONTROL',
        'RESULT:VIEW,DECLARE,HOLD,RELEASE',
        'SETTINGS:VIEW,UPDATE',
        'MESSAGE:VIEW,CREATE,EDIT,DELETE',
        'USER:VIEW,CREATE,EDIT,BLOCK,DELETE,RESTORE',
        'WEBSITE:VIEW',
        'PRIVILEGES:VIEW,UPDATE'
    ],
    ADMIN: [
        'DOWNLINE:VIEW,CREATE,EDIT,DEPOSIT,WITHDRAW',
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BETLIST:VIEW,REJECT',
        'RISK:VIEW',
        'BANKING:VIEW,DEPOSIT,WITHDRAW,APPROVE',
        'BANKING_METHOD:VIEW',
        'MATCH:VIEW,BLOCK',
        'RESULT:VIEW,DECLARE',
        'SETTINGS:VIEW',
        'MESSAGE:VIEW,CREATE',
        'USER:VIEW,EDIT,BLOCK'
    ],
    B2C_SUB_ADMIN: [
        'DOWNLINE:VIEW,CREATE,DEPOSIT,WITHDRAW',
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BETLIST:VIEW',
        'BANKING:VIEW,DEPOSIT,WITHDRAW,APPROVE',
        'USER:VIEW,EDIT,BLOCK'
    ],
    SENIOR_AFFILIATE: [
        'DOWNLINE:VIEW,CREATE,DEPOSIT',
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BANKING:VIEW,DEPOSIT'
    ],
    AFFILIATE: [
        'DOWNLINE:VIEW,CREATE',
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BANKING:VIEW,APPROVE_DOWNLINE',
        'USER:KYC_APPROVE_DOWNLINE'
    ],
    B2B_SUB_ADMIN: [
        'DOWNLINE:VIEW,CREATE,DEPOSIT,WITHDRAW',
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BETLIST:VIEW',
        'BANKING:VIEW,DEPOSIT,WITHDRAW,APPROVE',
        'USER:VIEW,EDIT,BLOCK'
    ],
    SUPER_AGENT: [
        'DOWNLINE:VIEW,CREATE,DEPOSIT,WITHDRAW',
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BETLIST:VIEW',
        'BANKING:VIEW,DEPOSIT,WITHDRAW'
    ],
    MASTER_AGENT: [
        'DOWNLINE:VIEW,CREATE,DEPOSIT',
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BETLIST:VIEW',
        'BANKING:VIEW,DEPOSIT'
    ],
    AGENT: [
        'DOWNLINE:VIEW,CREATE',
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BETLIST:VIEW',
        'BANKING:VIEW'
    ],
    PLAYER: [
        'ACCOUNT:VIEW,EDIT',
        'REPORT:VIEW',
        'BANKING:VIEW'
    ]
};

// Check if a role has a specific permission (delegates to cache → DB → hardcoded fallback)
function hasPermission(role, permission) {
    const normalizedRole = normalizeRole(role);
    const permissionCache = require('../services/permissionCache');
    if (permissionCache.isInitialized()) {
        return permissionCache.hasPermission(normalizedRole, permission);
    }
    // Fallback if cache not yet initialized (during startup)
    return _hardcodedCheck(normalizedRole, permission);
}

// Direct hardcoded check (used as fallback only)
function _hardcodedCheck(role, permission) {
    const perms = rolePermissions[normalizeRole(role)];
    if (!perms) return false;
    if (perms.includes('*')) return true;

    const [module, action] = permission.split(':');

    return perms.some(p => {
        const [mod, actions] = p.split(':');
        if (mod !== module) return false;
        if (actions === '*') return true;
        return actions.split(',').includes(action);
    });
}

// Get all visible menu items for a role
function getVisibleMenus(role) {
    const normalizedRole = normalizeRole(role);
    const allMenus = [
        { id: 'downline', label: 'Downline List', permission: 'DOWNLINE:VIEW' },
        { id: 'account', label: 'My Account', permission: 'ACCOUNT:VIEW' },
        { id: 'report', label: 'My Report', permission: 'REPORT:VIEW' },
        { id: 'betlist', label: 'BetList', permission: 'BETLIST:VIEW' },
        { id: 'betlive', label: 'BetListLive', permission: 'BETLIST:VIEW' },
        { id: 'risk', label: 'Risk Management', permission: 'RISK:VIEW' },
        { id: 'banking', label: 'Banking', permission: 'BANKING:VIEW' },
        { id: 'banking-method', label: 'Banking Method', permission: 'BANKING_METHOD:VIEW' },
        { id: 'block-market', label: 'Block Market', permission: 'MATCH:BLOCK' },
        { id: 'add-match', label: 'Add The Match', permission: 'MATCH:CREATE' },
        { id: 'admin-setting', label: 'Admin Setting', permission: 'SETTINGS:VIEW' },
        { id: 'company-payment', label: 'Company Payment', permission: 'COMPANY_PAYMENT:VIEW' },
        { id: 'result', label: 'Result', permission: 'RESULT:DECLARE' },
        { id: 'old-result', label: 'Old Result', permission: 'RESULT:VIEW' },
        { id: 'deposit-request', label: 'Deposit Request', permission: 'BANKING:APPROVE' },
        { id: 'withdraw-request', label: 'Withdraw Request', permission: 'BANKING:APPROVE' },
        { id: 'affiliate-withdraw', label: 'Affiliate Withdraw', permission: 'BANKING:APPROVE_DOWNLINE' },
        { id: 'affiliate-kyc', label: 'Affiliate KYC', permission: 'USER:KYC_APPROVE_DOWNLINE' },
        { id: 'privileges', label: 'Privileges', permission: 'PRIVILEGES:VIEW' }
    ];

    return allMenus.filter(menu => hasPermission(normalizedRole, menu.permission));
}

module.exports = { rolePermissions, hasPermission, getVisibleMenus };
