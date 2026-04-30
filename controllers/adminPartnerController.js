// controllers/adminPartnerController.js
const Partner = require('../models/Partner');
const bcrypt = require('bcrypt'); // Renamed for clarity
// const { sendEmail } = require('../utils/email');
const crypto = require('crypto'); // Native crypto for randomBytes and hash

const generateToken = () => 'sk_live_' + crypto.randomBytes(20).toString('hex');

// List pending partners
exports.listAll = async (req, res) => {
  try {
    const partners = await Partner.find({}).sort({ createdAt: -1 });
    res.json({ partners });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// Approve partner
exports.approvePartner = async (req, res) => {
  try {
    const { partnerId } = req.params;
    const partner = await Partner.findById(partnerId);
    if (!partner || partner.status !== 'pending') {
      return res.status(400).json({ error: 'Invalid partner or already processed.' });
    }

    // Generate token
    const plainApiToken = generateToken();
    const hashedApiToken = await bcrypt.hash(plainApiToken, 10);
    const tokenIndex = crypto.createHash('sha256').update(plainApiToken).digest('hex');

    partner.apiToken = hashedApiToken;
    partner.tokenIndex = tokenIndex;
    partner.status = 'active';
    await partner.save();

    // Email to partner
    // await sendEmail(
    //   partner.email,
    //   'Partner Request Approved',
    //   `<p>Hi ${partner.name},</p><p>Your request is approved! Your API token: <strong>${plainApiToken}</strong></p><p>Log in to dashboard.</p>`
    // );

    res.json({ message: 'Approved and token generated.', partnerId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Reject partner
exports.rejectPartner = async (req, res) => {
  try {
    const { partnerId } = req.params;
    const partner = await Partner.findById(partnerId);
    if (!partner || partner.status !== 'pending') {
      return res.status(400).json({ error: 'Invalid partner or already processed.' });
    }

    partner.status = 'rejected';
    await partner.save();

    // Email to partner
    // await sendEmail(
    //   partner.email,
    //   'Partner Request Rejected',
    //   `<p>Hi ${partner.name},</p><p>Sorry, your request was rejected. Contact support@sabhyata.in for details.</p>`
    // );

    res.json({ message: 'Rejected.', partnerId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};