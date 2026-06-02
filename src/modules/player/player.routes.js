const express = require('express');
const router = express.Router();
const db = require('../../config/db');

router.get('/deposit-info', async (req, res) => {
    const playerId = req.user?.id; // JWT থেকে আসবে (middleware দিয়ে protect করো)
    if (!playerId) return res.status(401).json({ message: 'Unauthorized' });

    try {
        const [agent] = await db.execute(`
            SELECT whatsapp_no, bkash_no, nagad_no 
            FROM users 
            WHERE id = (SELECT parent_id FROM users WHERE id = ?)
        `, [playerId]);

        if (agent.length === 0) {
            return res.status(404).json({ message: 'Agent not found' });
        }

        res.json({ success: true, data: agent[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;

