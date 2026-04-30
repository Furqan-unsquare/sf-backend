// routes/adminPartners.js
const express = require('express');
const router = express.Router();
const {
  listAll,
  approvePartner,
  rejectPartner
} = require('../../controllers/adminPartnerController');

// Partner approval routes
router.get('/list-all', listAll);
router.post('/approve/:partnerId', approvePartner);
router.post('/reject/:partnerId', rejectPartner);

module.exports = router;