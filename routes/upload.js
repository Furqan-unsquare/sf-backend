const express = require('express');
const multer = require('multer');
const router = express.Router();

// Use memory storage so we can forward buffer to Cloudflare
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB limit

const { uploadImage } = require('../controllers/uploadController');

// POST /api/upload-image
router.post('/upload-image', upload.single('file'), uploadImage);

module.exports = router;
