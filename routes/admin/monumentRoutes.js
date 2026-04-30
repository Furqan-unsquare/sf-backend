const express = require('express');
const router = express.Router();
const {
  getAllMonuments,
  getMonumentById,
  createMonument,
  updateMonument,
  deleteMonument,
} = require('../../controllers/monumentController');

// Monument routes
router.get('/', getAllMonuments);
router.get('/:id', getMonumentById);
router.post('/', createMonument);
router.put('/:id', updateMonument);
router.delete('/:id', deleteMonument);

module.exports = router;