const express = require('express');
const router = express.Router();
const { getAllMonuments, getMonumentById, getEventsForMonument } = require('../../controllers/monumentController');

// Monument routes
router.get('/', getAllMonuments);
router.get('/:id', getMonumentById);
router.get('/:id/events', getEventsForMonument);

module.exports = router;