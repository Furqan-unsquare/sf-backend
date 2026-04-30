const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const seatDataSchema = new mongoose.Schema(
  {
    seatId: {
      type: String,
      required: true,
    },
    row: {
      type: String,
      required: true,
    },
    number: {
      type: Number,
      required: true,
    },
    section: {
      type: String,
      required: true,
      default: "Main",
    },
    category: {
      type: String,
      enum: ["VIP", "Premium", "Gold", "Silver", "Bronze"],
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["available", "booked", "locked", "blocked", "active"],
      default: "available",
    },
    coords: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
    },
  },
  { _id: false }
);

const ticketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["adult", "child"],
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    seatLabel: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    bookingReference: {
      type: String,
      required: true,
      unique: true,
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    time: {
      type: String,
      required: true,
    },
    language: {
      type: String,
      default: "",
    },
    seats: [seatDataSchema],
    tickets: [ticketSchema], // ✅ Add tickets field
    usedTickets: [
      {
        ticketId: {
          type: String,
          required: true,
        },
        seatLabel: String,
        type: {
          type: String,
          enum: ["adult", "child", "seat"],
        },
        isUsed: {
          type: Boolean,
          default: true,
        },
        usedAt: {
          type: Date,
          default: Date.now,
        },
        verifiedBy: String,
      },
    ],

    adults: {
      type: Number,
      default: 0,
    },
    children: {
      type: Number,
      default: 0,
    },
    isForeigner: {
      type: Boolean,
      default: false,
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    totalAmount: {
      type: Number,
      required: true,
    },
    contactInfo: {
      name: { type: String },
      email: { type: String },
      phone: { type: String },
      altPhone: { type: String },
    },
    paymentMethod: {
      type: String,
      enum: ["card", "upi", "netbanking", "cash"],
    },
    notes: {
      type: String,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "cancelled",
        "expired",
        "refunded",
        "active",
      ],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "cancelled", "refunded"],
      default: "pending",
    },
    deviceId: {
      type: String,
    },
    sessionId: {
      type: String,
    },
    ipAddress: String,
    userAgent: String,

    expiresAt: {
      type: Date,
      index: true,
    },
    lockedAt: {
      type: Date,
      default: Date.now,
    },

    bookingType: {
      type: String,
      enum: ["user", "admin", "manual", "partner"],
      required: true,
      default: "user",
    },
    partner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Partner",
      default: null,
    },
    seatLockId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SeatLock",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index for auto-expiry of pending bookings
bookingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ✅ Generate bookingReference if not provided
bookingSchema.pre("save", function (next) {
  // Generate booking reference if not exists
  if (!this.bookingReference) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 6).toUpperCase();
    this.bookingReference = `BKG-${timestamp}-${random}`;
  }

  /* 
  // Update total amount if tickets exist
  if (this.tickets && this.tickets.length > 0) {
    this.totalAmount = this.tickets.reduce(
      (total, ticket) => total + ticket.price,
      0
    );
  }
  */

  next();
});

// Index for better query performance
bookingSchema.index({ event: 1, bookingReference: 1 });
bookingSchema.index({ user: 1 });
bookingSchema.index({ status: 1, expiresAt: 1 });
bookingSchema.index({ deviceId: 1, sessionId: 1 });

module.exports = mongoose.model("Booking", bookingSchema);
