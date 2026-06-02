const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const User = sequelize.define("User", {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    role: {
        type: DataTypes.ENUM(
            "OWNER", "MOTHER_PANEL", "WHITE_LABEL", "SUPER_ADMIN", "ADMIN",
            "B2C_SUB_ADMIN", "B2B_SUB_ADMIN", "SENIOR_AFFILIATE",
            "AFFILIATE", "SUPER_AGENT", "MASTER_AGENT", "AGENT", "PLAYER"
        ),
        allowNull: false,
        defaultValue: "PLAYER"
    },
    roleId: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    parentId: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    fullName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    balance: {
        type: DataTypes.DECIMAL(15, 2),
        allowNull: false,
        defaultValue: 0.00
    },
    isBetLocked: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    isDeleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    reviewMode: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    fullAccessMode: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: "active"
    },
    referralCode: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: true,
    },
    referredBy: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    commission_rate: {
        type: DataTypes.FLOAT,
        defaultValue: 0
    },
    whiteLabelId: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    lastLoginIp: {
        type: DataTypes.STRING,
        allowNull: true
    },
    maxConcurrentSessions: {
        type: DataTypes.INTEGER,
        defaultValue: 3
    },
    kycStatus: {
        type: DataTypes.ENUM('NOT_SUBMITTED', 'SUBMITTED', 'VERIFIED', 'APPROVED', 'REJECTED'),
        defaultValue: 'NOT_SUBMITTED'
    },
    kycVerified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    kycApproved: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    kycSubmittedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    kycVerifiedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    kycApprovedAt: {
        type: DataTypes.DATE,
        allowNull: true
    },
    kycRejectedReason: {
        type: DataTypes.STRING,
        allowNull: true
    },
    kycDocuments: {
        type: DataTypes.JSON,
        allowNull: true
    }
}, {
    tableName: "users",
    timestamps: true
});

module.exports = User;
