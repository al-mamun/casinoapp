const router = require("express").Router();
const { Message, User } = require("../../models");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorize } = require("../../middleware/authorize");
const { asyncHandler } = require("../../middleware/errorHandler");
const { validate, messageSchema } = require("../../utils/validation");
const { success, error, paginated } = require("../../utils/apiResponse");

// GET /api/v1/messages — all active messages
router.get("/", authenticate, asyncHandler(async (req, res) => {
    const { type, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const where = { isActive: true };
    if (type) where.type = type;

    const { count, rows } = await Message.findAndCountAll({
        where,
        include: [{ model: User, as: 'creator', attributes: ['id', 'username'] }],
        offset: Number(offset), limit: Number(limit),
        order: [['createdAt', 'DESC']]
    });

    return paginated(res, rows, count, page, limit);
}));

// POST /api/v1/messages/user
router.post("/user", authenticate, authorize('MESSAGE:CREATE'), asyncHandler(async (req, res) => {
    const { title, content, targetUserId } = req.body;
    const msg = await Message.create({
        type: 'USER', title, content, targetUserId, createdBy: req.user.id
    });
    return success(res, msg, "User message sent", 201);
}));

// GET /api/v1/messages/user
router.get("/user", authenticate, asyncHandler(async (req, res) => {
    const messages = await Message.findAll({
        where: { type: 'USER', targetUserId: req.user.id, isActive: true },
        order: [['createdAt', 'DESC']]
    });
    return success(res, messages);
}));

// POST /api/v1/messages/hyper
router.post("/hyper", authenticate, authorize('MESSAGE:CREATE'), asyncHandler(async (req, res) => {
    const { title, content } = req.body;
    const msg = await Message.create({
        type: 'HYPER', title, content, createdBy: req.user.id
    });
    return success(res, msg, "Hyper message created", 201);
}));

// GET /api/v1/messages/hyper
router.get("/hyper", authenticate, asyncHandler(async (req, res) => {
    const messages = await Message.findAll({
        where: { type: 'HYPER', isActive: true },
        order: [['createdAt', 'DESC']]
    });
    return success(res, messages);
}));

// PATCH /api/v1/messages/hyper/:id
router.patch("/hyper/:id", authenticate, authorize('MESSAGE:EDIT'), asyncHandler(async (req, res) => {
    const msg = await Message.findByPk(req.params.id);
    if (!msg) return error(res, "Message not found", 404);
    await msg.update(req.body);
    return success(res, msg, "Message updated");
}));

// POST /api/v1/messages/important
router.post("/important", authenticate, authorize('MESSAGE:CREATE'), asyncHandler(async (req, res) => {
    const { title, content } = req.body;
    const msg = await Message.create({
        type: 'IMPORTANT', title, content, createdBy: req.user.id
    });
    return success(res, msg, "Important message created", 201);
}));

// GET /api/v1/messages/important
router.get("/important", authenticate, asyncHandler(async (req, res) => {
    const messages = await Message.findAll({
        where: { type: 'IMPORTANT', isActive: true },
        order: [['createdAt', 'DESC']]
    });
    return success(res, messages);
}));

// PATCH /api/v1/messages/important/:id
router.patch("/important/:id", authenticate, authorize('MESSAGE:EDIT'), asyncHandler(async (req, res) => {
    const msg = await Message.findByPk(req.params.id);
    if (!msg) return error(res, "Message not found", 404);
    await msg.update(req.body);
    return success(res, msg, "Message updated");
}));

// POST /api/v1/messages/image
router.post("/image", authenticate, authorize('MESSAGE:CREATE'), asyncHandler(async (req, res) => {
    const { title, imageUrl, content } = req.body;
    const msg = await Message.create({
        type: 'IMAGE', title, content, imageUrl, createdBy: req.user.id
    });
    return success(res, msg, "Image message created", 201);
}));

// GET /api/v1/messages/image
router.get("/image", authenticate, asyncHandler(async (req, res) => {
    const messages = await Message.findAll({
        where: { type: 'IMAGE', isActive: true },
        order: [['createdAt', 'DESC']]
    });
    return success(res, messages);
}));

// DELETE /api/v1/messages/:id
router.delete("/:id", authenticate, authorize('MESSAGE:DELETE'), asyncHandler(async (req, res) => {
    const msg = await Message.findByPk(req.params.id);
    if (!msg) return error(res, "Message not found", 404);

    msg.isActive = false;
    await msg.save();
    return success(res, null, "Message deleted");
}));

module.exports = router;
