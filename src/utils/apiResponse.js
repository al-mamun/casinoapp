// Standardized API Response helpers

const success = (res, data = null, message = 'Success', statusCode = 200, meta = null) => {
    const response = { success: true, message, data };
    if (meta) response.meta = meta;
    return res.status(statusCode).json(response);
};

const error = (res, message = 'Error', statusCode = 500, errorCode = 'SERVER_ERROR', errors = []) => {
    const response = { success: false, message, errorCode };
    if (errors.length > 0) response.errors = errors;
    return res.status(statusCode).json(response);
};

const paginated = (res, data, total, page, limit, message = 'Success') => {
    return res.status(200).json({
        success: true,
        message,
        data,
        meta: {
            page: Number(page),
            limit: Number(limit),
            total,
            totalPages: Math.ceil(total / limit)
        }
    });
};

module.exports = { success, error, paginated };
