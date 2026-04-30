const mongoose = require('mongoose');

const abandonedCartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  // Add these fields for better tracking
  seats: [{
    seatId: String,
    row: String,
    number: String,
    price: Number
  }],
  date: {
    type: Date,
  },
  time: {
    type: String,
  },
  language: {
    type: String,
    default: 'none'
  },
  tickets: [{
    type: {
      type: String,
      enum: ['adult', 'child'],
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1
    },
    price: {
      type: Number,
      required: true,
      min: 0
    }
  }],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  contactInfo: {
    name: String,
    email: String,
    phone: String
  },
  sessionId: String,
  status: {
    type: String,
    enum: ['active', 'pending', 'recovered', 'abandoned', 'sent', 'expired'],
    default: 'active'
  },
  remindersSent: {
    type: Boolean,
    default: false
  },
  followupSent: {
    type: Boolean,
    default: false
  },
  lastReminderSent: Date,
  recoveredAt: Date,
  recoveredBookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },
  metadata: {
    browserInfo: String,
    deviceInfo: String,
    referrer: String,
    utm: {
      source: String,
      medium: String,
      campaign: String
    }
  }
}, {
  timestamps: true
});

// Indexes
abandonedCartSchema.index({ user: 1 });
abandonedCartSchema.index({ event: 1 });
abandonedCartSchema.index({ status: 1 });
abandonedCartSchema.index({ createdAt: -1 });

// Update status based on expiration
abandonedCartSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Calculate total tickets
abandonedCartSchema.virtual('totalTickets').get(function () {
  return this.tickets.reduce((sum, ticket) => sum + ticket.quantity, 0);
});

// Check if cart is expired
abandonedCartSchema.virtual('isExpired').get(function () {
  return new Date() > this.expiresAt;
});

module.exports = mongoose.model('AbandonedCart', abandonedCartSchema);