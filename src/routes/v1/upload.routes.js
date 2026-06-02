const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { success, error } = require("../../utils/apiResponse");

let UPLOADS_DIR = (process.env.VERCEL || process.env.VERCEL_REGION || process.env.AWS_REGION)
    ? path.join("/tmp", "uploads")
    : path.join(__dirname, "..", "..", "..", "public", "uploads");
try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch (err) {
    UPLOADS_DIR = path.join("/tmp", "uploads");
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase().slice(0, 8);
        const safeExt = /^\.(png|jpg|jpeg|gif|webp|svg|ico)$/.test(ext) ? ext : ".bin";
        const name = crypto.randomBytes(16).toString("hex") + safeExt;
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (req, file, cb) => {
        if (/^image\//.test(file.mimetype)) cb(null, true);
        else cb(new Error("Only image files are allowed"));
    }
});

// POST /api/v1/upload/image
router.post(
    "/image",
    authenticate,
    authorize("WEBSITE:UPDATE"),
    (req, res, next) => {
        upload.single("file")(req, res, (err) => {
            if (err) return error(res, err.message || "Upload failed", 400);
            if (!req.file) return error(res, "No file uploaded", 400);
            return success(res, {
                url: `/uploads/${req.file.filename}`,
                filename: req.file.filename,
                size: req.file.size,
                mimetype: req.file.mimetype
            }, "Uploaded", 201);
        });
    }
);

module.exports = router;
