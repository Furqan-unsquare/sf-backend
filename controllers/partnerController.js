const Partner = require('../models/Partner');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
// const { sendEmail } = require('../utils/email');

const generateToken = () => 'sk_live_' + crypto.randomBytes(20).toString('hex');

// Register: Pending status, no token, send emails
exports.registerPartner = async (req, res) => {
  try {
    const { name, email, password, webhookUrl } = req.body;
    const existingPartner = await Partner.findOne({ $or: [{ name }, { email }] });
    if (existingPartner) {
      return res.status(400).json({ error: 'Name or email already exists.' });
    }

    const partner = new Partner({
      name,
      email,
      password,
      webhookUrl,
      status: 'pending' // Default now
    });

    await partner.save();

    // Email to partner
    // await sendEmail(
    //   email,
    //   'Partner Registration Received',
    //   `<p>Hi ${name},</p><p>Your request to join Sabhyata Partner Program has been received. We will review and confirm within 24 hours.</p><p>Thank you!</p>`
    // );

    // // Email to admin
    // await sendEmail(
    //   process.env.ADMIN_EMAIL,
    //   'New Partner Registration Request',
    //   `<p>New partner request:</p><ul><li>Name: ${name}</li><li>Email: ${email}</li><li>Webhook: ${webhookUrl || 'Not set'}</li></ul><p>Approve/Reject via admin dashboard.</p>`
    // );

    res.status(201).json({
      message: 'Request submitted! Check your email for confirmation.',
      partnerId: partner._id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Login: Only for active
exports.loginPartner = async (req, res) => {
  try {
    const { email, password } = req.body;
    const partner = await Partner.findOne({ email }).select('+password');
    if (!partner || !(await partner.comparePassword(password)) || partner.status !== 'active') {
      return res.status(401).json({ error: 'Invalid credentials or pending approval.' });
    }

    // Generate session JWT
    const sessionToken = jwt.sign(
      { partnerId: partner._id },
      process.env.PARTNER_JWT_SECRET || 'your-partner-jwt-secret',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful!',
      sessionToken,
      partner: { name: partner.name, email: partner.email, webhookUrl: partner.webhookUrl }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get partner details (protected)
exports.getPartner = async (req, res) => {
  try {
    const partner = await Partner.findById(req.partner._id).select('-password');
    if (!partner) return res.status(404).json({ error: 'Partner not found' });

    res.json(partner.toObject());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Regenerate (protected, active only)
exports.regenerateToken = async (req, res) => {
  try {
    const partner = req.partner;
    if (partner.status !== 'active') {
      return res.status(400).json({ error: 'Not approved yet.' });
    }

    const plainApiToken = generateToken();
    const hashedApiToken = await bcrypt.hash(plainApiToken, 10);
    const tokenIndex = crypto.createHash('sha256').update(plainApiToken).digest('hex');

    partner.apiToken = hashedApiToken;
    partner.tokenIndex = tokenIndex;
    partner.lastUsed = new Date();
    await partner.save();

    res.json({
      message: 'Token regenerated!',
      apiToken: plainApiToken
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update webhook (protected)
exports.updateWebhook = async (req, res) => {
  try {
    const { webhookUrl } = req.body;
    const partner = req.partner;
    if (partner.status !== 'active') {
      return res.status(400).json({ error: 'Not approved yet.' });
    }

    partner.webhookUrl = webhookUrl;
    await partner.save();
    res.json({ message: 'Webhook updated', webhookUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};