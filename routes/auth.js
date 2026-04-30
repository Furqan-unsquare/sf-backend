const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const {
  register,
  login,
  staffLogin,
  getCurrentUser,
  logout,
  updateProfile,
  sendOtp,
  verifyOtp,
} = require('../controllers/authController');

const { protect } = require('../middleware/auth');
const {
  validateLogin,
  handleValidation
} = require('../middleware/validation');

// Rate limiter for OTP
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 5, // 5 OTP attempts
  keyGenerator: (req, res) => {
    return req.body.phone || req.body.email || req.ip;  
  },
  message: 'Too many OTP requests. Try again after 15 minutes.'
});

const verifyOtpLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // Max 5 attempts/min
  keyGenerator: (req, res) => {
    return req.body.phone || req.body.email || req.ip;
  },
  message: 'Too many OTP verification attempts. Try again after 1 minute.'
});

// Public routes
router.post('/register', register);
router.post('/login', validateLogin, handleValidation, login);
router.post('/staff-login', validateLogin, handleValidation, staffLogin);
router.post('/send-otp', otpLimiter, sendOtp);
router.post('/verify-otp', verifyOtpLimiter, verifyOtp);

// Protected routes
router.use(protect); // All routes below require authentication

router.get('/me', getCurrentUser);
router.post('/logout', logout);
router.put('/profile', updateProfile);
// router.put('/change-password', changePassword);

module.exports = router;