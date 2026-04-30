const mongoose = require('mongoose');

const seatLockSchema = new mongoose.Schema({
  lockId: {
    type: String,
    required: true,
    unique: true
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  time: {
    type: String,
    required: true
  },
  language: {
    type: String,
    default: ''
  },
  seats: [{
    type: String,
    required: true
  }],
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lockDuration: {
    type: Number,
    default: 1800 // 30 minutes in seconds
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'released', 'expired', 'converted'],
    default: 'active'
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// TTL index for auto-expiry
seatLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for queries
seatLockSchema.index({ eventId: 1, date: 1, time: 1, status: 1 });
seatLockSchema.index({ userId: 1, status: 1 });

// Method to check if lock is still valid
seatLockSchema.methods.isValid = function() {
  return this.status === 'active' && this.expiresAt > new Date();
};

// Static method to cleanup expired locks
seatLockSchema.statics.cleanupExpired = async function() {
  const now = new Date();
  const result = await this.updateMany(
    { 
      status: 'active',
      expiresAt: { $lte: now }
    },
    { 
      $set: { status: 'expired' }
    }
  );
  return result;
};

module.exports = mongoose.model('SeatLock', seatLockSchema);
