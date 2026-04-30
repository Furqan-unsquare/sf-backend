const express = require('express');
const router = express.Router();
const { verifyPayment, verifyTicket } = require('../controllers/bookingController');
const { createOrder } = require('../controllers/paymentsController');
const { protect } = require('../middleware/auth');

// Create a Razorpay order for an existing booking
router.post('/create-order', protect, createOrder);
router.post('/verify', protect, verifyPayment);
router.get('/verify-ticket/:bookingId/:ticketId', protect, verifyTicket);

module.exports = router;