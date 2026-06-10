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

// Magic-byte signatures for allowed image types
const IMAGE_MAGIC = [
    { bytes: [0x89, 0x50, 0x4E, 0x47], ext: ".png",  mime: "image/png"  },      // PNG
    { bytes: [0xFF, 0xD8, 0xFF],        ext: ".jpg",  mime: "image/jpeg" },      // JPEG
    { bytes: [0x47, 0x49, 0x46, 0x38], ext: ".gif",  mime: "image/gif"  },      // GIF87a / GIF89a
    { bytes: [0x52, 0x49, 0x46, 0x46], ext: ".webp", mime: "image/webp", extra: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] } }, // WEBP (RIFF....WEBP)
    { bytes: [0x42, 0x4D],             ext: ".bmp",  mime: "image/bmp"  },      // BMP
];

function detectImageMime(buf) {
    for (const sig of IMAGE_MAGIC) {
        if (sig.bytes.every((b, i) => buf[i] === b)) {
            if (sig.extra) {
                const { offset, bytes } = sig.extra;
                if (!bytes.every((b, i) => buf[offset + i] === b)) continue;
            }
            return { valid: true, mime: sig.mime, ext: sig.ext };
        }
    }
    return { valid: false };
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        // Extension assigned later after magic-byte check; default to .bin
        const name = crypto.randomBytes(16).toString("hex") + ".bin";
        cb(null, name);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (req, file, cb) => {
        // Pre-filter on declared MIME — actual bytes validated after save
        if (/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.mimetype)) cb(null, true);
        else cb(new Error("Only PNG, JPEG, GIF, WebP or BMP images are allowed"));
    }
});

// POST /api/v1/upload/image
router.post(
    "/image",
    authenticate,
    authorize("WEBSITE:UPDATE"),
    (req, res, next) => {
        upload.single("file")(req, res, async (err) => {
            if (err) return error(res, err.message || "Upload failed", 400);
            if (!req.file) return error(res, "No file uploaded", 400);

            const savedPath = req.file.path;
            try {
                // Read first 12 bytes for magic-byte validation
                const fd = fs.openSync(savedPath, "r");
                const buf = Buffer.alloc(12);
                fs.readSync(fd, buf, 0, 12, 0);
                fs.closeSync(fd);

                const detected = detectImageMime(buf);
                if (!detected.valid) {
                    fs.unlink(savedPath, () => {});
                    return error(res, "File content does not match an allowed image type", 400, "INVALID_MIME");
                }

                // Rename .bin → correct extension
                const correctPath = savedPath.replace(/\.bin$/, detected.ext);
                fs.renameSync(savedPath, correctPath);
                const filename = path.basename(correctPath);

                return success(res, {
                    url: `/uploads/${filename}`,
                    filename,
                    size: req.file.size,
                    mimetype: detected.mime
                }, "Uploaded", 201);
            } catch (readErr) {
                fs.unlink(savedPath, () => {});
                return error(res, "Failed to validate file", 500);
            }
        });
    }
);

module.exports = router;
