const express = require('express');
const router = express.Router();

const {
  getAllAbandonedCarts,
  getAbandonedCartById,
  deleteAbandonedCart,
  exportAbandonedCartsCSV
} = require('../../controllers/abandonedCartController');

// Abandoned cart routes
router.get('/', getAllAbandonedCarts);
router.get('/export', exportAbandonedCartsCSV);
router.get('/:id', getAbandonedCartById);
router.delete('/:id', deleteAbandonedCart);

module.exports = router;