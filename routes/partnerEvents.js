const express = require('express');
const router = express.Router();
const { validateToken, sessionAuth } = require('../middleware/auth'); // Reuse auth middleware
const { getEventById, getRemainingCapacity } = require('../controllers/eventController');  // Reuse your controller
const { getAllMonuments, getMonumentById } = require('../controllers/monumentController');
const { createTempBookingPartner } = require('../controllers/tempBookingController')
const { getSeatLayout } = require('../controllers/seatLayoutController');

const { createOrder } = require('../controllers/paymentsController');
const { verifyGenericPayment, getBookingById } = require('../controllers/bookingController');

router.get('/check', validateToken, (req, res) => {
  res.json({ message: 'API working' });
});

// Monuments
router.get('/monuments', validateToken, sessionAuth, getAllMonuments);
router.get('/monuments/:id', validateToken, getMonumentById);

router.get('/events/:id', validateToken,sessionAuth, getEventById);
router.get('/seat-layout/:event_id', validateToken,sessionAuth, getSeatLayout);

router.get('/:id/remaining-capacity', getRemainingCapacity);
router.post('/temp-bookings/create', validateToken,sessionAuth, createTempBookingPartner);

// Payments (create order and verify)
router.post('/payments/create-order', validateToken,sessionAuth, createOrder);
router.post('/payments/verify', validateToken,sessionAuth, verifyGenericPayment);

// Bookings - expose booking details to partners
router.get('/bookings/:id', validateToken,sessionAuth, getBookingById);

module.exports = router;