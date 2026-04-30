// routes/tempBookingRoutes.js
const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const { createTempBooking, testCleanup } = require('../controllers/tempBookingController');

// Create temporary booking (lock seats)
router.post('/create', optionalAuth, createTempBooking);

// ✅ Test cleanup endpoint
router.post('/test-cleanup', testCleanup);

module.exports = router;
