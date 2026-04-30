const express = require('express');
const router = express.Router();
const { getAllBookings, getBookingById } = require('../../controllers/bookingController');

const { optionalAuth } = require('../../middleware/auth');

// Booking routes
router.get('/', getAllBookings);
router.get('/:id', optionalAuth, getBookingById);

module.exports = router;
