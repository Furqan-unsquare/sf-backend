const express = require('express');
const router = express.Router();

// Import individual route modules
const bookingRoutes = require('./bookingRoutes');
const eventRoutes = require('./eventRoutes');
const monumentRoutes = require('./monumentRoutes');
const abandonedCartRoutes = require('./abandonedCartRoutes');
const seatLayoutRoutes = require('./seatLayouts');

// Each route file now decides which endpoints need protect/restrictTo
router.use('/bookings', bookingRoutes);
router.use('/events', eventRoutes);
router.use('/seat-layouts', seatLayoutRoutes);
router.use('/monuments', monumentRoutes);
router.use('/abandoned-carts', abandonedCartRoutes);

module.exports = router;
 