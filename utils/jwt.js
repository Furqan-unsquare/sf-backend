const jwt = require('jsonwebtoken');

// Generate JWT token
exports.generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '24h' // Enforce 24h for all users as requested
  });
};

// Verify JWT token
exports.verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

// Generate tokens for response
exports.generateTokenResponse = (user) => {
  const payload = {
    id: user._id,
    email: user.email,
    role: user.role
  };

  const token = exports.generateToken(payload);

  return {
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive
    }
  };
};