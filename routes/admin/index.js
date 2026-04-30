// routes/adminRoutes.js (updated with logging middleware)
const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../../middleware/auth');
const globalAdminLogger = require('../../middleware/globalAdminLogger');

// Import individual route modules
const dashboardRoutes = require('./dashboardRoutes');
const bookingRoutes = require('./bookingRoutes');
const eventRoutes = require('./eventRoutes');
const userRoutes = require('./userRoutes');
const monumentRoutes = require('./monumentRoutes');
const abandonedCartRoutes = require('./abandonedCartRoutes');
const seatLayoutRoutes = require('./seatLayouts');
const bulkBookingRoutes = require('./bulkBookingRoutes');
const adminPartnerRoutes = require('./adminPartners');
const adminLogRoutes = require('./logs');

// Apply authentication and role restriction to all routes
router.use(protect);
router.use(restrictTo('admin', 'sub-admin', 'staff', 'Event-Staff'));

// Apply Global Logger (Must be after auth, before routes)
router.use(globalAdminLogger);

// Mount individual route modules
router.use('/dashboard', dashboardRoutes);
router.use('/bookings', bookingRoutes);
router.use('/bulk-bookings', bulkBookingRoutes);
router.use('/events', eventRoutes);
router.use('/seat-layouts', seatLayoutRoutes);
router.use('/users', userRoutes);
router.use('/monuments', monumentRoutes);
router.use('/abandoned-carts', abandonedCartRoutes);
router.use('/partners', adminPartnerRoutes);
router.use('/logs', adminLogRoutes);

module.exports = router;