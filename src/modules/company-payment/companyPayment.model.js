const { DataTypes } = require("sequelize");
const sequelize = require("../../config/sequelize.db");

const CompanyPayment = sequelize.define("CompanyPayment", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    type: {
        type: DataTypes.ENUM('SETTLEMENT', 'COMMISSION_PAYOUT', 'PROVIDER_PAYMENT', 'EXPENSE'),
        allowNull: false
    },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    reference: { type: DataTypes.STRING, allowNull: true },
    status: {
        type: DataTypes.ENUM('PENDING', 'COMPLETED', 'CANCELLED'),
        defaultValue: 'PENDING'
    },
    createdBy: { type: DataTypes.INTEGER, allowNull: false },
    approvedBy: { type: DataTypes.INTEGER, allowNull: true }
}, {
    tableName: "company_payments",
    timestamps: true
});

module.exports = CompanyPayment;
