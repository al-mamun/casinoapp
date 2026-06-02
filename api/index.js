let app;
let loadError;

try {
    app = require("../src/app");
} catch (err) {
    loadError = err;
}

module.exports = (req, res) => {
    if (loadError) {
        return res.status(500).json({
            success: false,
            message: loadError.message
        });
    }

    return app(req, res);
};
