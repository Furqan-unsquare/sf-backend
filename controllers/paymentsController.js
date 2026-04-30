const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Razorpay = require('razorpay');
const Booking = require('../models/Booking');
const AbandonedCart = require('../models/AbandonedCart');

const razorpayClients = {};

const VENUE_RAZORPAY_MAP = {
  'red fort': '',
  'purana quila': '1',
  "humayun's tomb": '2',
  "safdarjung's tomb": '3',
  'mehrauli archaeological park': '4'
};

const getRazorpayConfig = (venue) => {
  const normalizedVenue = (venue || '').trim().toLowerCase();
  console.log(`🔍 [Razorpay Debug] Attempting to find config for normalized venue: "${normalizedVenue}"`);
  console.log(`📊 [Razorpay Debug] Available mappings (keys):`, JSON.stringify(Object.keys(VENUE_RAZORPAY_MAP)));

  const suffix = VENUE_RAZORPAY_MAP[normalizedVenue] !== undefined ? VENUE_RAZORPAY_MAP[normalizedVenue] : undefined;

  if (suffix === undefined) {
    console.log(`⚠️ [Razorpay Debug] No suffix mapping found for venue "${venue}". Using default fallback.`);
    return {
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
      source: 'Default Fallback'
    };
  }

  const key_id = process.env[`RAZORPAY_KEY_ID${suffix}`];
  const key_secret = process.env[`RAZORPAY_KEY_SECRET${suffix}`];

  if (key_id && key_secret) {
    console.log(`✅ [Razorpay Debug] Found specific config for "${venue}" using suffix "${suffix}"`);
    return { key_id, key_secret, source: `Suffix ${suffix}` };
  }

  console.log(`⚠️ [Razorpay Debug] Missing keys for suffix "${suffix}" in .env. Using default fallback.`);
  // Default fallback
  return {
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
    source: 'Default Fallback (Missing Suffix Keys)'
  };
};

const getRazorpay = (venue) => {
  const config = getRazorpayConfig(venue);
  if (!config.key_id || !config.key_secret) {
    console.error(`❌ [Razorpay Debug] No valid keys found at all!`);
    return null;
  }

  if (razorpayClients[config.key_id]) {
    return { client: razorpayClients[config.key_id], key_id: config.key_id, key_secret: config.key_secret };
  }

  console.log(`🚀 [Razorpay Debug] Creating new Razorpay instance for Key ID: ${config.key_id}`);
  const client = new Razorpay({ key_id: config.key_id, key_secret: config.key_secret });
  razorpayClients[config.key_id] = client;
  return { client, key_id: config.key_id, key_secret: config.key_secret };
};

// Create Razorpay Order
exports.createOrder = async (req, res) => {
  try {
    const { bookingId, currency = 'INR', contactInfo, specialNotes } = req.body;

    console.log('=== CREATE RAZORPAY ORDER ===');
    console.log('Booking ID:', bookingId);

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'Booking ID is required' });
    }

    const booking = await Booking.findById(bookingId).populate('event');

    if (!booking) {
      console.log('❌ [Razorpay Debug] Booking not found:', bookingId);
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const venue = booking.event?.venue;
    console.log(`📊 [Razorpay Debug] Booking ID: ${bookingId}, Venue from DB: "${venue}"`);

    if (booking.event) {
      console.log(`📊 [Razorpay Debug] Event found: "${booking.event.name}" (ID: ${booking.event._id})`);
    } else {
      console.log(`⚠️ [Razorpay Debug] Event NOT populated for booking!`);
    }

    const rpData = getRazorpay(venue);

    if (!rpData) {
      return res.status(500).json({
        success: false,
        message: 'Payment gateway not configured on server'
      });
    }

    const { client: rp, key_id } = rpData;

    console.log(`💳 [Razorpay] Selected account for venue "${venue}": ${key_id}`);

    if (booking.paymentStatus === 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Booking already paid'
      });
    }

    // Update contact info if provided (important for abandoned cart recovery -> successful payment flow)
    if (contactInfo) {
      booking.contactInfo = contactInfo;
    }
    if (specialNotes) {
      booking.notes = specialNotes;
    }
    await booking.save();

    // STRICTLY use backend calculated amount
    const finalAmount = booking.totalAmount;

    console.log(`Amount from Booking: ${finalAmount}`);

    if (finalAmount === undefined || finalAmount === null) {
      return res.status(400).json({ success: false, message: 'Could not determine payment amount from booking' });
    }

    const amountInPaise = Math.round(finalAmount * 100);

    const options = {
      amount: amountInPaise,
      currency,
      receipt: bookingId.toString(), // Ensure string
      payment_capture: 1,
    };

    const order = await rp.orders.create(options);

    console.log('✓ Razorpay order created:', order.id);

    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: (order.amount / 100).toFixed(2),
        currency: order.currency,
        key: key_id
      }
    });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: err.message
    });
  }
};

// ✅ FIXED: Verify Payment with PROPER TICKET GENERATION
exports.verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingId,
      contactInfo,
      specialNotes
    } = req.body;

    console.log('=== PAYMENT VERIFICATION STARTED ===');

    const booking = await Booking.findById(bookingId).populate('event');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    const venue = booking.event?.venue;
    const rpConfig = getRazorpayConfig(venue);

    if (!rpConfig.key_secret) {
      return res.status(500).json({
        success: false,
        message: 'Payment gateway secret not configured on server'
      });
    }

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', rpConfig.key_secret)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature'
      });
    }

    // currentUser is not defined in this scope, it should be req.user
    const currentUser = req.user;
    if (currentUser) {
      booking.user = currentUser._id || currentUser.id;
      booking.bookingType = (currentUser.role === 'user' ? 'user' : 'manual');
    }

    await booking.save();

    // Update contact info
    if (contactInfo) {
      booking.contactInfo = {
        name: contactInfo.name,
        email: contactInfo.email,
        phone: contactInfo.phone,
        altPhone: contactInfo.altPhone
      };
    }

    if (specialNotes) {
      booking.notes = specialNotes;
    }

    // Update booking to confirmed (NO TICKET GENERATION)
    booking.status = 'confirmed';
    booking.paymentStatus = 'paid';
    booking.razorpayPaymentId = razorpay_payment_id;
    booking.razorpayOrderId = razorpay_order_id;
    booking.razorpaySignature = razorpay_signature;
    booking.expiresAt = null;

    await booking.save();

    // ✅ MARK ABANDONED CART AS RECOVERED
    const sessionId = booking.sessionId || req.body.sessionId;
    const phone = booking.contactInfo?.phone;

    if (sessionId || phone) {
      try {
        const query = { status: 'active' };
        if (sessionId && phone) {
          query.$or = [{ sessionId: sessionId }, { 'contactInfo.phone': phone }];
        } else if (sessionId) {
          query.sessionId = sessionId;
        } else {
          query['contactInfo.phone'] = phone;
        }

        const recoveredCart = await AbandonedCart.findOneAndUpdate(
          query,
          {
            status: 'recovered',
            recoveredAt: new Date(),
            recoveredBookingId: booking._id
          },
          { new: true }
        );

        if (recoveredCart) {
          console.log(`✅ [Payments] Abandoned cart recovered for ${phone || sessionId}`);
        }
      } catch (err) {
        console.error('⚠️ [Payments] Failed to update abandoned cart status:', err);
      }
    }

    console.log('✓ Booking confirmed:', booking.bookingReference);
    console.log('✓ Tickets will be generated on-the-fly by frontend');
    console.log('=== PAYMENT VERIFICATION COMPLETED ===\n');

    return res.json({
      success: true,
      message: 'Payment verified and booking confirmed',
      data: {
        bookingId: booking._id,
        bookingReference: booking.bookingReference,
        paymentId: razorpay_payment_id
      }
    });

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed',
      error: error.message
    });
  }
};

// Verify Ticket (QR Scan) - Simplified without tickets array
exports.verifyTicket = async (req, res) => {
  try {
    const { bookingId, ticketId } = req.params;

    console.log('=== TICKET VERIFICATION STARTED ===');
    console.log('URL params received:', { bookingId, ticketId });

    if (!bookingId || !ticketId) {
      return res.status(400).json({
        success: false,
        message: 'Missing booking ID or ticket ID'
      });
    }

    // Find booking by bookingReference or _id
    let booking;
    const mongoose = require('mongoose');

    const isValidObjectId = mongoose.Types.ObjectId.isValid(bookingId) && bookingId.length === 24;

    if (isValidObjectId) {
      console.log('Searching by MongoDB _id...');
      booking = await Booking.findById(bookingId).populate('event').populate('user', 'name email phone');
    } else {
      console.log('Searching by bookingReference...');
      booking = await Booking.findOne({ bookingReference: bookingId }).populate('event').populate('user', 'name email phone');
    }

    if (!booking) {
      console.log('ERROR: Booking not found');
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    console.log('✓ Booking found:', booking.bookingReference);
    console.log('  - Payment Status:', booking.paymentStatus);
    console.log('  - Status:', booking.status);

    if (booking.paymentStatus !== 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payment not completed'
      });
    }

    if (booking.status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: 'Booking not confirmed'
      });
    }

    // ===== VALIDATE TICKET ID FORMAT =====
    // Expected format: TKT-{bookingRef}-{seatLabel}-{index}
    const expectedPrefix = `TKT-${booking.bookingReference}`;

    if (!ticketId.startsWith(expectedPrefix)) {
      console.log('ERROR: Invalid ticket ID format');
      return res.status(400).json({
        success: false,
        message: 'Invalid ticket ID - does not match booking reference',
        details: {
          expectedPrefix: expectedPrefix,
          receivedTicketId: ticketId
        }
      });
    }

    // ===== TRACK USED TICKETS =====
    // Initialize usedTickets array if not exists
    if (!booking.usedTickets) {
      booking.usedTickets = [];
    }

    // Check if ticket already used
    const isAlreadyUsed = booking.usedTickets.some(ut => ut.ticketId === ticketId);

    if (isAlreadyUsed) {
      const usedTicket = booking.usedTickets.find(ut => ut.ticketId === ticketId);
      return res.status(400).json({
        success: false,
        message: 'Ticket already used',
        data: {
          bookingReference: booking.bookingReference,
          totalAmount: booking.totalAmount,
          eventName: booking.event?.name,
          date: booking.date,
          time: booking.time,
          usedAt: usedTicket.usedAt,
          verifiedBy: usedTicket.verifiedBy
        }
      });
    }

    // ===== PARSE TICKET INFO =====
    // Extract seat/participant info from ticketId
    const ticketParts = ticketId.replace(expectedPrefix + '-', '').split('-');
    const seatLabel = ticketParts[0]; // e.g., "A1" or "adult"
    const ticketIndex = parseInt(ticketParts[1]) - 1; // Convert to 0-indexed

    // Get seat info if available
    const seatInfo = booking.seats && booking.seats[ticketIndex]
      ? [booking.seats[ticketIndex]]
      : [];

    // Determine ticket type
    let ticketType = 'adult';
    if (ticketIndex >= (booking.adults || 0)) {
      ticketType = 'child';
    }

    // ===== MARK TICKET AS USED =====
    booking.usedTickets.push({
      ticketId: ticketId,
      seatLabel: seatLabel,
      type: ticketType,
      isUsed: true,
      usedAt: new Date(),
      verifiedBy: req.user?.name || req.user?.email || 'Scanner'
    });

    await booking.save();

    console.log('✓ Ticket verified and marked as used');
    console.log(`  - Ticket: ${ticketId}`);
    console.log(`  - Total used tickets: ${booking.usedTickets.length}`);
    console.log('=== VERIFICATION COMPLETED ===\n');

    res.json({
      success: true,
      message: 'Ticket verified - Entry granted',
      data: {
        bookingReference: booking.bookingReference,
        ticketId: ticketId,
        seatLabel: seatLabel,
        eventName: booking.event?.name,
        venue: booking.event?.venue,
        date: booking.date,
        time: booking.time,
        seats: seatInfo,
        contactInfo: booking.contactInfo,
        ticketType: ticketType,
        ticketCount: 1,
        totalAmount: booking.totalAmount,
        verifiedAt: booking.usedTickets[booking.usedTickets.length - 1].usedAt,
        verifiedBy: booking.usedTickets[booking.usedTickets.length - 1].verifiedBy
      }
    });

  } catch (error) {
    console.error('Ticket verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed',
      error: error.message
    });
  }
};

module.exports = exports;
