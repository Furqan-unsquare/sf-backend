const express = require('express');
const router = express.Router();
const {
  createSeatLayout,
  getSeatLayout,
  updateSeatLayout,
  deleteSeatLayout,
  publishSeatLayout,
} = require('../../controllers/seatLayoutController');
const SeatLayout = require('../../models/SeatLayout');

// Admin routes
router.post('/', createSeatLayout);
router.get('/:event_id', getSeatLayout);
router.put('/:event_id', updateSeatLayout);
router.delete('/:event_id', deleteSeatLayout);
router.post('/:event_id/publish', publishSeatLayout);

// Update category price
router.put('/:eventId/category-price', async (req, res) => {
  const { eventId } = req.params;
  const { categoryName, price } = req.body;

  console.log(`Updating category price for eventId: ${eventId}, category: ${categoryName}, price: ${price}`);

  try {
    const seatLayout = await SeatLayout.findOne({ event_id: eventId });
    if (!seatLayout) {
      console.error(`Seat layout not found for eventId: ${eventId}`);
      return res.status(404).json({ success: false, message: 'Seat layout not found' });
    }

    const updatedLayout = await seatLayout.updateCategoryPrice(categoryName, price);
    console.log(`Updated seat layout: ${JSON.stringify(updatedLayout, null, 2)}`);
    res.json({ success: true, message: 'Category price updated successfully', data: updatedLayout });
  } catch (error) {
    console.error('Error updating category price:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;