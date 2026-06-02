const { AppError } = require("../utils/errors");

// Global error handler middleware
const errorHandler = (err, req, res, next) => {
    // Log error in development
    if (process.env.NODE_ENV !== 'production') {
        console.error('Error:', err.message);
        if (!err.isOperational) console.error(err.stack);
    }

    // Handle known operational errors
    if (err.isOperational) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
            errorCode: err.errorCode,
            errors: err.errors || []
        });
    }

    // Handle Sequelize validation errors
    if (err.name === 'SequelizeValidationError') {
        const errors = err.errors.map(e => ({ field: e.path, message: e.message }));
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errorCode: 'VALIDATION_ERROR',
            errors
        });
    }

    // Handle Sequelize unique constraint errors
    if (err.name === 'SequelizeUniqueConstraintError') {
        const field = err.errors[0]?.path || 'unknown';
        return res.status(409).json({
            success: false,
            message: `${field} already exists`,
            errorCode: 'CONFLICT'
        });
    }

    // Handle unknown errors
    return res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        errorCode: 'SERVER_ERROR'
    });
};

// Async route wrapper to catch async errors
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, asyncHandler };
