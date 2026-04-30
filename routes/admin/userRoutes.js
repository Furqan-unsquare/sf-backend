const express = require('express');
const router = express.Router();

const {
  getAllUsers,
  getUserById,
  toggleUserBlock,
  exportUsersCSV,
  getUserStats
} = require('../../controllers/userController');

// User routes
router.get('/', getAllUsers);
router.get('/export', exportUsersCSV);
router.get('/stats', getUserStats);
router.get('/:id', getUserById);

router.post('/:id/block', toggleUserBlock);

module.exports = router;