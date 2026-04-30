const { v4: uuidv4 } = require('uuid');
const Booking = require('../models/Booking');
const ShowSeatLayout = require('../models/ShowSeatLayout');
const Event = require('../models/Event');
const redis = require('../config/redis');
const { scheduleBookingExpiration } = require('../utils/bookingExpiration');
const mongoose = require('mongoose');

// Create bulk booking (manual booking by sub-admin)
exports.createBulkBooking = async (req, res) => {
  try {
    const {
      eventId,
      date,
      time,
      language,
      seats,
      adults,
      children,
      totalAmount,
      contactInfo,
      paymentMethod = 'cash',
      notes
    } = req.body;

    console.log('=== CREATE BULK BOOKING STARTED ===');
    console.log('Request body:', req.body);

    // Validation
    if (!eventId || !date || !time) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields (eventId, date, time)'
      });
    }

    if (!contactInfo || !contactInfo.name || !contactInfo.phone) {
      return res.status(400).json({
        success: false,
        message: 'Contact information (name, phone) is required'
      });
    }

    // Get sub-admin user ID
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required'
      });
    }

    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Generate booking reference
    const bookingReference = `BKG-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;
    console.log('Generated booking reference:', bookingReference);

    // Generate session ID for seat locking
    const sessionId = uuidv4();

    // Lock seats temporarily for 30 minutes
    if (seats && seats.length > 0) {
      const seatLayout = await ShowSeatLayout.findOne({
        event_id: eventId,
        date: new Date(date),
        time: time,
        language: language || ''
      });

      if (seatLayout) {
        const seatIds = seats.map(s => s.seatId);

        // Release any expired locks first (30 minutes for bulk bookings)
        await seatLayout.releaseExpired(30, 'bulk');

        // Check seat availability in ShowSeatLayout
        const unavailableSeats = [];
        for (const seatId of seatIds) {
          const seat = seatLayout.layout_data.find(s => s.seatId === seatId);
          if (!seat || seat.status !== 'available') {
            unavailableSeats.push(seatId);
          }
        }

        if (unavailableSeats.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Some seats are no longer available',
            unavailableSeats
          });
        }

        // Check against confirmed bookings (paid bookings only)
        const confirmedBookings = await Booking.find({
          event: eventId,
          date: new Date(date),
          time,
          $or: [
            { paymentStatus: 'paid' },
            { bookingType: 'user' }
          ]
        });

        const bookedSeatIds = new Set();
        confirmedBookings.forEach(booking => {
          booking.seats.forEach(seat => bookedSeatIds.add(seat.seatId));
        });

        const conflictedSeats = seatIds.filter(id => bookedSeatIds.has(id));

        if (conflictedSeats.length > 0) {
          // return res.status(400).json({
          //   success: false,
          //   message: 'Some seats are already booked',
          //   conflicted: conflictedSeats
          // });
        }

        // Lock seats in the layout for 30 minutes
        const lockResult = await seatLayout.lockSeats(seatIds, sessionId, 30, 'bulk');
        if (!lockResult || !lockResult.success) {
          console.error('Failed to lock seats:', lockResult);
          return res.status(400).json({
            success: false,
            message: 'Failed to lock seats',
            conflicted: lockResult?.conflicted || []
          });
        }
        console.log(`Locked ${seatIds.length} seats temporarily for 30 minutes`);
      } else {
        console.log('No seat layout found - proceeding without locking');
      }
    }

    // Create bulk booking with pending status
    // Redis will handle the expiration

    // Clean seat data
    const cleanedSeats = (seats || []).map(seat => ({
      seatId: seat.seatId,
      row: seat.row,
      number: seat.number,
      section: seat.section,
      category: seat.category,
      price: seat.price,
      coords: seat.coords
    }));

    // Generate tickets
    const tickets = [];
    let ticketCounter = 1;

    // Add adult tickets
    for (let i = 0; i < (adults || 0); i++) {
      tickets.push({
        ticketId: `${bookingReference}-T${ticketCounter++}`,
        type: 'adult',
        price: cleanedSeats[i]?.price || event.price || 0,
        isUsed: false,
        seatLabel: cleanedSeats[i]?.seatId || null
      });
    }

    // Add child tickets
    for (let i = 0; i < (children || 0); i++) {
      tickets.push({
        ticketId: `${bookingReference}-T${ticketCounter++}`,
        type: 'child',
        price: cleanedSeats[adults + i]?.price || event.childPrice || event.price || 0,
        isUsed: false,
        seatLabel: cleanedSeats[adults + i]?.seatId || null
      });
    }

    const booking = await Booking.create({
      bookingReference,
      event: eventId,
      date: new Date(date),
      time,
      language: language || 'en',
      seats: cleanedSeats,
      tickets,
      adults: adults || 0,
      children: children || 0,
      isForeigner: req.body.isForeigner || false,
      totalAmount: totalAmount || 0,
      status: 'pending',
      paymentStatus: 'pending',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes hold
      lockedAt: new Date(),
      bookingType: 'bulk',
      paymentMethod,
      contactInfo: {
        name: contactInfo.name,
        email: contactInfo.email || '',
        phone: contactInfo.phone
      },
      createdBy: userId,
      bookingType: 'manual',
      notes: notes || ''
    });

    // Save the booking to the database
    const savedBooking = await booking.save();

    // Schedule the booking for expiration check in Redis
    await scheduleBookingExpiration(savedBooking._id.toString());

    console.log('✓ Bulk booking created with pending status:', booking._id);

    res.status(201).json({
      success: true,
      message: 'Bulk booking created successfully (pending approval)',
      data: {
        bookingId: booking._id,
        bookingReference: booking.bookingReference,
        status: 'pending',
        notes: booking.notes
      }
    });
  } catch (error) {
    console.error('Error creating bulk booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create bulk booking',
      error: error.message
    });
  }
};

// Create bulk booking for walking events
exports.createBulkBookingWalking = async (req, res) => {
  const session = await mongoose.startSession(); // For atomicity
  session.startTransaction();

  try {
    const {
      eventId,
      date,
      time,
      adults,
      children,
      totalAmount, // Optional: Will be recalculated for consistency
      contactInfo,
      paymentMethod = 'cash',
      notes,
      language,
    } = req.body;

    const isForeigner = req.body.isForeigner || false;

    console.log('=== CREATE BULK WALKING BOOKING STARTED ===');
    console.log('Request body:', req.body);
    console.log('isForeigner from req.body:', isForeigner); // Debug log

    // Simple validation
    if (!eventId || !date || !time) {
      throw new Error('Missing required fields (eventId, date, time)');
    }

    if (!contactInfo || !contactInfo.name || !contactInfo.phone) {
      throw new Error('Contact info required');
    }

    const userId = req.user?._id;
    if (!userId) {
      throw new Error('User authentication required');
    }

    // Find event and check capacity (within transaction)
    const event = await Event.findById(eventId).session(session);
    if (!event) {
      throw new Error('Event not found');
    }

    // Get all held + confirmed bookings for the day and time
    const currentBookings = await Booking.find({
      event: eventId,
      date: new Date(date),
      time,
      status: { $in: ['pending', 'confirmed'] } // Holds pending spots
    }).session(session);

    // Sum up tickets already held/committed
    let alreadyHeld = 0;
    currentBookings.forEach(each => {
      alreadyHeld += (each.adults || 0) + (each.children || 0);
    });
    const requestTotal = (adults || 0) + (children || 0);
    if (alreadyHeld + requestTotal > event.capacity) {
      throw new Error(`Not enough available spots. Available: ${Math.max(event.capacity - alreadyHeld, 0)}`);
    }

    // Calculate prices based on isForeigner (mirroring frontend logic)
    const baseAdultPrice = event.price || 0;
    const childDiscount = (event.childDiscountPercentage || 0) / 100;
    const foreignerIncrease = (event.foreignerIncreasePercentage || 0) / 100;
    const adultPrice = isForeigner ? baseAdultPrice * (1 + foreignerIncrease) : baseAdultPrice;
    const childPrice = isForeigner
      ? baseAdultPrice * (1 + foreignerIncrease) * (1 - childDiscount)
      : baseAdultPrice * (1 - childDiscount);

    // Generate booking reference
    const bookingReference = `BKG-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;

    // Generate tickets (no seats for walking) with calculated prices
    const tickets = [];
    let ticketCounter = 1;
    for (let i = 0; i < (adults || 0); i++) {
      tickets.push({
        ticketId: `${bookingReference}-T${ticketCounter++}`,
        type: 'adult',
        price: adultPrice,
        isUsed: false
      });
    }
    for (let i = 0; i < (children || 0); i++) {
      tickets.push({
        ticketId: `${bookingReference}-T${ticketCounter++}`,
        type: 'child',
        price: childPrice,
        isUsed: false
      });
    }

    // Recalculate totalAmount for consistency (sum of ticket prices, rounded to match frontend)
    const unroundedTotal = adultPrice * (adults || 0) + childPrice * (children || 0);
    const calculatedTotalAmount = Math.round(unroundedTotal);

    // For manual/sub-admin: Hold for 30 min (pending)
    // For user: Instant confirm (if bookingType='user')
    const isManual = req.body.bookingType === 'manual' || !req.body.bookingType; // Default to manual if not specified
    const status = isManual ? 'pending' : 'confirmed';
    const expiresAt = isManual ? new Date(Date.now() + 1 * 60 * 1000) : null; // 1 minute for manual holds

    const booking = await Booking.create([{
      bookingReference,
      event: eventId,
      date: new Date(date),
      time,
      language: language || 'en',
      seats: [],
      tickets,
      adults,
      children,
      totalAmount: calculatedTotalAmount, // Use calculated value (ignores req.body if mismatched)
      status,
      paymentStatus: isManual ? 'pending' : 'paid', // Pending payment for manual
      paymentMethod,
      contactInfo: {
        name: contactInfo.name,
        email: contactInfo.email || '',
        phone: contactInfo.phone
      },
      createdBy: userId,
      expiresAt, // Only for pending/manual
      lockedAt: new Date(), // Audit when held
      bookingType: isManual ? 'manual' : 'user',
      isForeigner, // Explicitly set from destructured value
      notes: notes || ''
    }], { session });

    console.log(`✓ Walking booking created (${status}):`, booking[0]._id);
    console.log('Saved isForeigner:', booking[0].isForeigner); // Debug log

    // Schedule expiration for manual/pending bookings (1 minute)
    if (status === 'pending') {
      await scheduleBookingExpiration(booking[0]._id.toString());
    }

    // Optional: Notify admin for pending bookings
    if (status === 'pending') {
      // e.g., sendEmailToAdmins(`New pending booking: ${bookingReference}`);
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: isManual
        ? 'Bulk walking booking created (pending approval for 30 min)'
        : 'Bulk walking booking confirmed instantly',
      data: {
        bookingId: booking[0]._id,
        bookingReference: booking[0].bookingReference,
        status,
        expiresAt: status === 'pending' ? expiresAt : null,
        availableAfterHold: event.capacity - alreadyHeld - requestTotal,
        totalAmount: calculatedTotalAmount, // Return calculated value
        isForeigner: booking[0].isForeigner, // Return the saved value for verification
        notes: booking[0].notes
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Error creating walking booking:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create walking bulk booking',
      available: null // Include in response for UX
    });
  }
};

// Get bulk booking details
exports.getBulkBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId)
      .populate('event', 'name venue thumbnail price')
      .populate('createdBy', 'name email');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Error fetching bulk booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking',
      error: error.message
    });
  }
};