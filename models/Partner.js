const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const partnerSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  apiToken: { type: String }, // Only set on approval
  tokenIndex: { type: String}, // Only set on approval
  status: { type: String, enum: ['pending', 'active', 'rejected', 'revoked'], default: 'pending' }, // New defaults to pending
  webhookUrl: { type: String },
  lastUsed: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

partnerSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

partnerSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

partnerSchema.methods.compareToken = async function(plainToken) {
  return await bcrypt.compare(plainToken, this.apiToken);
};

module.exports = mongoose.model('Partner', partnerSchema);