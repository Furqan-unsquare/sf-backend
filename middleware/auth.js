const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Partner = require('../models/Partner');
const crypto = require('crypto');

// Protect routes - authentication required (for JWT users)
exports.protect = async (req, res, next) => {
  try {
    let token;

    // Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Access denied. No token provided.' 
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // console.log('Decoded token:', decoded); // DEBUG

    // Get user from token
    const user = await User.findById(decoded.id).select('-password');
    
    // console.log('User found:', user ? { id: user._id, email: user.email } : 'No user'); // DEBUG
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Token invalid. User not found.' 
      });
    }

    // Check if user is active and not blocked
    if (!user.isActive || user.isBlocked) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is inactive or blocked.' 
      });
    }

    req.user = user;
    // console.log('req.user set:', { id: req.user._id, email: req.user.email }); // DEBUG
    next();
  } catch (error) {
    console.error('Auth middleware error:', error); // DEBUG
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token.' 
      });
    } else if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired.' 
      });
    }
    
    return res.status(500).json({ 
      success: false, 
      message: 'Server error during authentication.',
      error: error.message 
    });
  }
};

// Optional authentication - allows access with or without token
exports.optionalAuth = async (req, res, next) => {
  try {
    let token;

    // Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // If no token, continue without authentication
    if (!token) {
      req.user = null;
      return next();
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from token
      const user = await User.findById(decoded.id).select('-password');
      
      // If user exists and is active, attach to request
      if (user && user.isActive && !user.isBlocked) {
        req.user = user;
      } else {
        req.user = null;
      }
    } catch (err) {
      // Invalid token, but don't block the request
      req.user = null;
    }

    next();
  } catch (error) {
    // On any error, just continue without user
    req.user = null;
    next();
  }
};

// Restrict to specific roles (for JWT users)
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }
    next();
  };
};

// Validate Partner API Token (for third-party partners)
exports.validateToken = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ success: false, error: 'Missing Authorization header' });
  }

  const [scheme, token] = header.split(' ');
  if (!/^apikey$/i.test(scheme) || !token) {
    return res.status(401).json({ success: false, error: 'Invalid Authorization format' });
  }

  // lookup partner by tokenIndex (same logic you already use)[file:11]
  const tokenIndex = crypto.createHash('sha256').update(token).digest('hex');
  const partner = await Partner.findOne({ tokenIndex, status: 'active' });

  if (!partner) {
    return res.status(401).json({ success: false, error: 'Invalid or revoked API key' });
  }

  req.partner = partner;
  partner.lastUsed = new Date();
  await partner.save();
  next();
};

exports.protectPartner = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, error: 'No session token provided.' });
    }

    const decoded = jwt.verify(token, process.env.PARTNER_JWT_SECRET || 'your-partner-jwt-secret');
    const partner = await Partner.findById(decoded.partnerId);
    if (!partner || partner.status !== 'active') {
      return res.status(401).json({ success: false, error: 'Invalid session.' });
    }

    req.partner = partner;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Session expired. Log in again.' });
    }
    res.status(500).json({ success: false, error: 'Server error.' });
  }
};


exports.sessionAuth = async(req, res, next) => {
  const sessionToken = req.headers['x-session-token'];
  if (!sessionToken) {
    return res.status(401).json({ success: false, error: 'Missing session token' });
  }

  jwt.verify(sessionToken, process.env.PARTNER_JWT_SECRET, (err, payload) => {
    if (err) {
      return res.status(401).json({ success: false, error: 'Invalid or expired session token' });
    }

    req.session = payload; // or req.user
    next();
  });
};