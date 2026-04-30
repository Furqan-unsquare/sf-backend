const express = require('express');
const router = express.Router();
const { protect, optionalAuth } = require('../../middleware/auth');

const {
  getAllEvents,
  getEventById,
  toggleInterest,
  getRemainingCapacity
} = require('../../controllers/eventController');

// Public routes with optional authentication (to check userInterested status)
router.get('/', optionalAuth, getAllEvents);

router.get('/:id', optionalAuth, getEventById);

// User route (requires authentication)
router.patch('/:id/interest', protect, toggleInterest);

router.get('/:id/remaining-capacity', getRemainingCapacity);

module.exports = router;
