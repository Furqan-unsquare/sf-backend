const express = require('express');
const router = express.Router();
const {
  getAllBookings,
  getBookingById,
  createBooking,
  updateBooking,
  deleteBooking,
  exportBookingsCSV,
  getBookingAnalytics
} = require('../../controllers/bookingController');
const {
  getPendingBookings,
  approveBooking,
  rejectBooking,
  getMyBookings
} = require('../../controllers/manualBookingController');

// Manual booking routes 
router.get('/pending', getPendingBookings);
router.get('/my-bookings', getMyBookings);

// Standard booking routes
router.get('/', getAllBookings);
router.get('/export', exportBookingsCSV);
router.get('/analytics', getBookingAnalytics);
router.post('/', createBooking);

// Parameterized routes (MUST be last)
router.get('/:id', getBookingById);
router.put('/:id', updateBooking);
router.delete('/:id', deleteBooking);
router.post('/:id/approve', approveBooking);
router.post('/:id/reject', rejectBooking);

module.exports = router;