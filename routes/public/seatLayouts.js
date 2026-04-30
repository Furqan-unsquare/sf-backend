const express = require('express');
const router = express.Router();
const { getSeatLayout } = require('../../controllers/seatLayoutController');

// Admin routes
router.get('/:event_id', getSeatLayout);

module.exports = router;