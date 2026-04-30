// routes/admin/logs.js
const express = require('express');
const router = express.Router();
const { getAllLogs } = require('../../controllers/adminLogController');

router.get('/', getAllLogs);

module.exports = router;
