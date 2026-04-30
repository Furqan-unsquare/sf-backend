// routes/partners.js
const express = require('express');
const router = express.Router();
const { protectPartner } = require('../middleware/auth');
const {
  registerPartner,
  loginPartner,
  getPartner,
  regenerateToken,
  updateWebhook
} = require('../controllers/partnerController');

// Partner routes
router.post('/register', registerPartner);
router.post('/login', loginPartner);
router.get('/dashboard', protectPartner, getPartner);
router.post('/regenerate', protectPartner, regenerateToken);
router.put('/webhook', protectPartner, updateWebhook);

module.exports = router;