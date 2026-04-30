const express = require('express');
const multer = require('multer');
const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/events/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });
const {
  getAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  toggleEventStatus,
} = require('../../controllers/eventController');

// router.use(adminActivityMiddleware('event')); // Removed: Handled globally

// Event routes
router.get('/', getAllEvents);
router.get('/:id', getEventById);
router.post('/', upload.array('images', 10), createEvent);
router.put('/:id', upload.array('images', 10), updateEvent);
router.delete('/:id', deleteEvent);
router.patch('/:id/status', toggleEventStatus);


module.exports = router;
