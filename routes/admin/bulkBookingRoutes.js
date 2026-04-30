const express = require('express');
const router = express.Router();
const { createBulkBooking, getBulkBooking, createBulkBookingWalking } = require('../../controllers/bulkBookingController');

// Create bulk booking (manual booking with seat locking)
router.post('/create', createBulkBooking);

// Create bulk booking (walking)
router.post('/create-walking', createBulkBookingWalking);

// Get bulk booking details
router.get('/:bookingId', getBulkBooking);

module.exports = router;
