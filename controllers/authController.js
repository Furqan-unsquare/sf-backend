const User = require('../models/User');
const AdminLog = require('../models/AdminLog');
const { generateTokenResponse } = require('../utils/jwt');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const otps = new Map(); // In-memory OTP storage (expires in 5 min)

// Register user
exports.register = async (req, res) => {
  try {
    console.log('Register payload received:', req.body);
    const { name, email, password, phone, role = 'user' } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Create new user
    const user = await User.create({
      name,
      email,
      password,
      phone,
      role
    });



    // Generate token response
    const tokenResponse = generateTokenResponse(user);

    // Manual Logging for Admin/Staff creating users
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Check if the actor is admin/staff
        const actor = await User.findById(decoded.id);
        if (actor && (actor.role === 'admin' || actor.role === 'sub-admin' || actor.role === 'staff')) {
          await AdminLog.create({
            admin: actor._id,
            action: 'create',
            resource: 'user',
            resourceId: String(user._id),
            details: {
              body: { name, email, phone, role }, // Store limited details
              createdByName: actor.name,
              createdByEmail: actor.email,
              createdByRole: actor.role
            },
            changes: {
              after: { name, email, phone, role }
            },
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.headers['user-agent'],
            endpoint: req.originalUrl,
            method: req.method,
            status: 'success'
          });
        }
      } catch (logError) {
        console.error('Failed to log admin registration action:', logError);
        // Don't fail the registration if logging fails
      }
    }

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: tokenResponse
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
};

// Login user (admin only)
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists and get password
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Restrict manual login to admins and sub-admins only
    if (user.role !== 'admin' && user.role !== 'sub-admin') {
      return res.status(401).json({
        success: false,
        message: 'Please use the appropriate login page for your role'
      });
    }

    // Check if user is active and not blocked
    if (!user.isActive || user.isBlocked) {
      return res.status(401).json({
        success: false,
        message: 'Account is inactive or blocked'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token response
    const tokenResponse = generateTokenResponse(user);

    res.json({
      success: true,
      message: 'Login successful',
      data: tokenResponse
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
};

// Staff login
exports.staffLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if user exists and get password
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Restrict manual login to staff, Event-Staff and sub-admin only
    const { role } = req.body;
    if (user.role !== 'staff' && user.role !== 'Event-Staff' && user.role !== 'sub-admin') {
      return res.status(401).json({
        success: false,
        message: 'Please use the appropriate login page for your role'
      });
    }

    // Validate if the requested role matches the user's role
    if (role && user.role !== role) {
      return res.status(401).json({
        success: false,
        message: `Access denied. Your account does not have the ${role} role.`
      });
    }

    // Check if user is active and not blocked
    if (!user.isActive || user.isBlocked) {
      return res.status(401).json({
        success: false,
        message: 'Account is inactive or blocked'
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token response
    const tokenResponse = generateTokenResponse(user);

    res.json({
      success: true,
      message: 'Login successful',
      data: tokenResponse
    });
  } catch (error) {
    console.error('Staff login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
};

// Send OTP
exports.sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit phone required' });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expires = Date.now() + 5 * 60 * 1000;
    otps.set(phone, { otp, expires });

    // Log OTP as requested
    console.log(`[OTP] Generated for ${phone}: ${otp}`);

    const apiKey = "OeAOrzXWQwyNwZms";
    const senderId = "SABHYF";
    const templateId = "1107176820012426796";
    const message = `Your OTP for Sabhyata Foundation is ${otp} . Please do not share this OTP with anyone.`;
    const format = "json";

    const params = new URLSearchParams({
      apikey: apiKey,
      senderid: senderId,
      template_id: templateId,
      number: phone,
      message: message,
      format: format
    });

    const url = `https://msg.mtalkz.com/V2/http-api.php?${params.toString()}`;

    const response = await fetch(url);
    const data = await response.json();
    console.log("MTalkz API Response:", data);

    if (response.ok) {
      if (data.status === 'OK' || data.type === 'success') {
        res.json({ success: true, message: 'OTP sent' });
      } else {
        // Handle provider level errors even if HTTP 200
        console.error('MTalkz Provider Error:', data);
        throw new Error(`Provider Error: ${data.message || 'Unknown provider error'}`);
      }
    } else {
      throw new Error('Failed to send OTP via Provider');
    }
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ success: false, message: 'Failed to send OTP', error: error.message });
  }
};

// Verify OTP
exports.verifyOtp = async (req, res) => {
  try {
    const { phone, otp, name, email } = req.body;

    const stored = otps.get(phone);
    if (!stored || Date.now() > stored.expires) {
      return res.status(400).json({ success: false, message: 'OTP expired or invalid' });
    }

    if (stored.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    let user = await User.findOne({ phone });
    if (!user) {
      const randomPassword = crypto.randomBytes(16).toString('hex');
      user = await User.create({
        name: name || `${phone}`,
        email: email || null,
        phone,
        password: await bcrypt.hash(randomPassword, 12),
        role: 'user'
      });
    } else {
      // UPDATE name/email only if provided and different
      if (name && name.trim() && user.name !== name.trim()) {
        user.name = name.trim();
      }
      if (email && email.trim() && user.email !== email.trim()) {
        // Optional: check if email already exists
        // const existingEmail = await User.findOne({ email: email.trim() });
        // if (existingEmail && existingEmail._id.toString() !== user._id.toString()) {
        //   return res.status(400).json({ success: false, message: 'Email already in use' });
        // }
        user.email = email.trim();
      }
    }

    if (!user.isActive || user.isBlocked) {
      return res.status(401).json({ success: false, message: 'Account is inactive or blocked' });
    }

    user.lastLogin = new Date();
    await user.save();

    const tokenResponse = generateTokenResponse(user);
    otps.delete(phone);

    res.json({
      success: true,
      message: 'Login successful',
      data: tokenResponse
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
};


// Get current user
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          isActive: user.isActive,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user information',
      error: error.message
    });
  }
};

// Logout (client-side token removal)
exports.logout = async (req, res) => {
  res.json({
    success: true,
    message: 'Logout successful'
  });
};

// Update user profile (name, email, phone)
exports.updateProfile = async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update fields if provided
    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;

    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get user with password
    const user = await User.findById(req.user.id).select('+password');

    // Check current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change password',
      error: error.message
    });
  }
};