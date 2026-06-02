// ==================== ALL MODELS ====================

// Core Models
const User = require("../modules/user/user.model");
const Wallet = require("../modules/wallet/wallet.model");
const Role = require("../modules/roles/role.model");
const Permission = require("../modules/roles/permission.model");
const RolePermission = require("../modules/roles/rolePermission.model");

// Sports & Betting Models
const League = require("../modules/leagues/leagues.model");
const Match = require("../modules/matches/matches.model");
const Market = require("../modules/markets/markets.model");
const Bet = require("../modules/bets/bets.model");
const Result = require("../modules/result/result.model");

// Financial Models
const Transaction = require("../modules/transaction/transaction.model");
const Commission = require("../modules/commission/commission.model");
const DepositRequest = require("../modules/deposit-request/depositRequest.model");
const WithdrawRequest = require("../modules/withdraw-request/withdrawRequest.model");
const BankingMethod = require("../modules/banking-method/bankingMethod.model");
const CompanyPayment = require("../modules/company-payment/companyPayment.model");

// System Models
const Message = require("../modules/message/message.model");
const SystemSettings = require("../modules/system-settings/systemSettings.model");
const Notification = require("../modules/notification/notification.model");
const BlockedIP = require("../modules/blocked-ip/blockedIp.model");
const WhiteLabel = require("../modules/white-label/whiteLabel.model");
const PlayerStats = require("../modules/player-stats/playerStats.model");
const Bonus = require("../modules/bonus/bonus.model");
const Session = require("../modules/session/session.model");
const AuditLog = require("../core/audit.engine");

// ==================== RELATIONS ====================

// User <-> Wallet (1:1)
User.hasOne(Wallet, { foreignKey: "userId", as: "wallet" });
Wallet.belongsTo(User, { foreignKey: "userId" });

// User <-> Role
User.belongsTo(Role, { foreignKey: "roleId", as: "roleInfo" });

// User <-> Parent (self-referencing)
User.belongsTo(User, { foreignKey: "parentId", as: "parent" });
User.hasMany(User, { foreignKey: "parentId", as: "children" });

// Role <-> Permission (N:N)
Role.belongsToMany(Permission, { through: RolePermission, foreignKey: "roleId" });
Permission.belongsToMany(Role, { through: RolePermission, foreignKey: "permissionId" });

// League <-> Match (1:N)
League.hasMany(Match, { foreignKey: "leagueId" });
Match.belongsTo(League, { foreignKey: "leagueId" });

// Match <-> Market (1:N)
Match.hasMany(Market, { foreignKey: "matchId" });
Market.belongsTo(Match, { foreignKey: "matchId" });

// Match <-> Bet (1:N)
Match.hasMany(Bet, { foreignKey: "matchId" });
Bet.belongsTo(Match, { foreignKey: "matchId" });

// User <-> Bet (1:N)
User.hasMany(Bet, { foreignKey: "userId" });
Bet.belongsTo(User, { foreignKey: "userId" });

// Match <-> Result (1:N)
Match.hasMany(Result, { foreignKey: "matchId" });
Result.belongsTo(Match, { foreignKey: "matchId" });

// User <-> Transaction (1:N)
User.hasMany(Transaction, { foreignKey: "userId" });
Transaction.belongsTo(User, { foreignKey: "userId" });

// User <-> DepositRequest (1:N)
User.hasMany(DepositRequest, { foreignKey: "userId" });
DepositRequest.belongsTo(User, { foreignKey: "userId" });

// User <-> WithdrawRequest (1:N)
User.hasMany(WithdrawRequest, { foreignKey: "userId" });
WithdrawRequest.belongsTo(User, { foreignKey: "userId" });

// User <-> Notification (1:N)
User.hasMany(Notification, { foreignKey: "userId" });
Notification.belongsTo(User, { foreignKey: "userId" });

// User <-> PlayerStats (1:1)
User.hasOne(PlayerStats, { foreignKey: "userId", as: "stats" });
PlayerStats.belongsTo(User, { foreignKey: "userId" });

// User <-> AuditLog (1:N)
User.hasMany(AuditLog, { foreignKey: "userId" });
AuditLog.belongsTo(User, { foreignKey: "userId" });

// User <-> Message (createdBy)
User.hasMany(Message, { foreignKey: "createdBy" });
Message.belongsTo(User, { foreignKey: "createdBy", as: "creator" });

// User <-> WhiteLabel (N:1)
User.belongsTo(WhiteLabel, { foreignKey: "whiteLabelId", as: "whiteLabel" });
WhiteLabel.hasMany(User, { foreignKey: "whiteLabelId" });

// User <-> Session (1:N)
User.hasMany(Session, { foreignKey: "userId" });
Session.belongsTo(User, { foreignKey: "userId" });

// ==================== EXPORTS ====================

module.exports = {
    User,
    Wallet,
    Role,
    Permission,
    RolePermission,
    League,
    Match,
    Market,
    Bet,
    Result,
    Transaction,
    Commission,
    DepositRequest,
    WithdrawRequest,
    BankingMethod,
    CompanyPayment,
    Message,
    SystemSettings,
    Notification,
    BlockedIP,
    WhiteLabel,
    PlayerStats,
    Bonus,
    Session,
    AuditLog
};
