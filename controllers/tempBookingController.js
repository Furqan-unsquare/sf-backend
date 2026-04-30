const Booking = require('../models/Booking');
const SeatLayout = require('../models/SeatLayout');
const ShowSeatLayout = require('../models/ShowSeatLayout');
const Event = require('../models/Event');
const { resolveSeatPrice } = require('../utils/pricingRules');
const { v4: uuidv4 } = require('uuid');

/**
 * Compute backend-authoritative total amount for a seated show.
 * Uses dynamic pricing rules (per row/date/time) + child discount + foreigner increase.
 * Does NOT trust any MongoDB-stored seat price.
 */
function computeSeatedTotalAmount({
  event,
  date,
  time,
  seats,
  adults = 0,
  children = 0,
  isForeigner = false,
  isSpecial = false,
}) {
  if (!event) {
    throw new Error('Event is required for pricing');
  }

  const childDiscount = event.childDiscountPercentage || 0;
  const foreignerIncrease = event.foreignerIncreasePercentage || 0;

  // 1. Resolve base price per seat
  // If special event: use dynamic pricing rules (backend authoritative)
  // If regular event: use stored seat price (MongoDB authoritative)
  const baseSeatPrices = seats.map((seat) => {
    if (isSpecial) {
      const rowKey = seat.row;
      return resolveSeatPrice({
        date,
        time,
        row: rowKey,
      });
    } else {
      return seat.price;
    }
  });

  // 2. Apply foreigner increase if applicable
  let seatPrices = baseSeatPrices.map((p) =>
    isForeigner ? p * (1 + foreignerIncrease / 100) : p
  );

  // 3. Sort ascending so cheapest seats get child discount
  seatPrices.sort((a, b) => a - b);

  // 4. Apply child discount to first N seats (children)
  const disc = 1 - childDiscount / 100;
  const ticketPrices = seatPrices.map((p, i) =>
    i < children ? p * disc : p
  );

  // 5. Sum and round
  const total = ticketPrices.reduce((sum, p) => sum + p, 0);
  return Math.round(total);
}

// Create temporary booking and optionally lock seats
exports.createTempBooking = async (req, res) => {
  try {
    const {
      eventId,
      date,
      time,
      language,
      seats,
      adults,
      children,
      isForeigner,
      deviceId,
      sessionId,
      paymentMethod
    } = req.body;

    // Calculate total amount on backend
    let calculatedTotalAmount = 0;

    console.log('=== CREATE TEMP BOOKING STARTED ===');

    // Validation
    if (!eventId || !date || !time) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields (eventId, date, time)'
      });
    }

    if (!deviceId || !sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Device/session information required'
      });
    }

    // Compute total tickets
    const totalTickets = (adults || 0) + (children || 0);

    // Enforce max 10 tickets for user bookings
    if (totalTickets > 10) {
      return res.status(400).json({ success: false, message: 'Maximum 10 tickets allowed per booking for users' });
    }

    // Get user ID if logged in
    const userId = req.user?._id || null;

    // Get IP and user agent
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // ===== VALIDATE REQUESTED DATE / TIME / LANGUAGE =====
    // Parse date as local date to avoid timezone shifts when only YYYY-MM-DD is provided
    const [yStr, mStr, dStr] = String(date).split('-');
    const reqDate = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1, parseInt(dStr, 10));
    if (isNaN(reqDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }

    const sameDay = (d1, d2) => {
      const a = new Date(d1);
      const b = new Date(d2);
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    };

    // Validate language param - only allow null/none, 'hi', 'en'
    const langInput = typeof language === 'string' ? language.toLowerCase() : language;
    const allowedLangs = [undefined, null, 'none', 'hi', 'en'];
    if (!allowedLangs.includes(langInput)) {
      return res.status(400).json({ success: false, message: 'Invalid language. Allowed values: none, hi, en' });
    }
    const lang = (langInput === 'none' ? null : langInput);

    let timeExists = false;
    let slotMatches = false;

    // Normalize and validate time string to avoid mismatches (trim and enforce HH:mm)
    const timeStr = typeof time === 'string' ? time.trim() : time;
    if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(timeStr)) {
      return res.status(400).json({ success: false, message: 'Invalid event time format' });
    }

    try {
      if (event.recurrence === 'daily' && event.dailySchedule) {
        const { startDate, endDate, timeSlots } = event.dailySchedule;
        console.log('[Daily Validation] Start:', startDate, 'End:', endDate, 'ReqDate:', reqDate);

        if (startDate && endDate) {
          const checkDate = new Date(reqDate);
          checkDate.setHours(0, 0, 0, 0);

          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);

          const end = new Date(endDate);
          end.setHours(0, 0, 0, 0);

          console.log('[Daily Validation] Date Check - Query:', checkDate, 'Start:', start, 'End:', end);

          if (checkDate >= start && checkDate <= end) {
            const slotsAtTime = (timeSlots || []).filter(ts => (ts.time || '').trim() === timeStr);
            timeExists = slotsAtTime.length > 0;

            console.log('[Daily Validation] Slots at time', timeStr, ':', slotsAtTime);

            if (lang) {
              slotMatches = slotsAtTime.some(ts => {
                if (!ts.isLangAvailable) return false;
                if (Array.isArray(ts.lang)) {
                  return ts.lang.map(l => String(l).toLowerCase()).includes(lang);
                }
                return String(ts.lang).toLowerCase() === lang;
              });
            } else {
              slotMatches = slotsAtTime.some(ts => !ts.isLangAvailable);
            }

            console.log('[Daily Validation] Lang:', lang, 'TimeExists:', timeExists, 'SlotMatches:', slotMatches);
          }
        }
      } else if (event.recurrence === 'specific' && Array.isArray(event.specificSchedules)) {
        const dayMatch = event.specificSchedules.find(s => sameDay(s.date, reqDate));
        if (dayMatch) {
          const slotsAtTime = (dayMatch.timeSlots || []).filter(ts => (ts.time || '').trim() === timeStr);
          timeExists = slotsAtTime.length > 0;
          if (lang) {
            slotMatches = slotsAtTime.some(ts => ts.isLangAvailable && Array.isArray(ts.lang) ? ts.lang.map(l => String(l).toLowerCase()).includes(lang) : String(ts.lang).toLowerCase() === lang);
          } else {
            slotMatches = slotsAtTime.some(ts => !ts.isLangAvailable);
          }
        }
      }
    } catch (err) {
      console.error('Schedule validation error (user):', err);
      timeExists = false;
      slotMatches = false;
    }

    if (!slotMatches) {
      // Debug info to help reproducing client-reported edge cases
      try {
        let debugSlots = [];
        if (event.recurrence === 'daily' && event.dailySchedule) {
          const { timeSlots } = event.dailySchedule;
          debugSlots = (timeSlots || []).filter(ts => (ts.time || '').trim() === timeStr).map(ts => ({ time: ts.time, isLangAvailable: ts.isLangAvailable, lang: ts.lang }));
        } else if (event.recurrence === 'specific' && Array.isArray(event.specificSchedules)) {
          const dayMatch = event.specificSchedules.find(s => sameDay(s.date, reqDate));
          if (dayMatch) {
            debugSlots = (dayMatch.timeSlots || []).filter(ts => (ts.time || '').trim() === timeStr).map(ts => ({ time: ts.time, isLangAvailable: ts.isLangAvailable, lang: ts.lang }));
          }
        }
        console.warn('Slot validation failed', { eventId, date, time: timeStr, lang, timeExists, debugSlots });
      } catch (err) {
        console.warn('Error producing slot debug info', err);
      }

      if (timeExists && lang) {
        return res.status(400).json({ success: false, message: 'Selected time exists but does not support the specified language; use language="none" or omit language' });
      }
      return res.status(400).json({ success: false, message: 'Selected date/time is not available for this event' });
    }

    // ===== ENFORCE 30-MINUTE CUTOFF =====
    try {
      const [hourStr, minStr] = timeStr.split(':');
      const eventDateTime = new Date(reqDate);
      eventDateTime.setHours(parseInt(hourStr, 10), parseInt(minStr, 10), 0, 0);

      const now = new Date();
      const diffMs = eventDateTime - now;
      const cutoffMs = 30 * 60 * 1000; // 30 minutes

      if (diffMs <= 0) {
        return res.status(400).json({ success: false, message: 'Cannot book for past event times' });
      }

      if (diffMs < cutoffMs) {
        return res.status(400).json({ success: false, message: 'Bookings close 30 minutes before the event start. Please select an earlier time or date' });
      }
    } catch (err) {
      console.error('Event time parsing error (user):', err);
      return res.status(400).json({ success: false, message: 'Invalid event time format' });
    }

    // ===== GENERATE BOOKING REFERENCE (TEMP FORMAT) =====
    const bookingReference = `ID-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;
    console.log('Generated temp booking reference:', bookingReference);

    // ===== CAPACITY VALIDATION FOR WALKING EVENTS =====
    if (event.type === 'walking') {
      console.log('Walking event detected - validating capacity');
      console.log(`🔎 LOOKING FOR EXISTING SESSION:`);
      console.log(`   - SessionID: ${sessionId}`);
      console.log(`   - EventID: ${eventId}`);
      console.log(`   - Date: ${date} (Parsed: ${new Date(date).toISOString()})`);
      console.log(`   - Time: ${time}`);

      // Create start/end of day for robust date matching
      const requestDate = new Date(date);
      const startOfDay = new Date(requestDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(requestDate);
      endOfDay.setHours(23, 59, 59, 999);

      // ✅ CHECK IF USER ALREADY HAS ACTIVE SESSION FOR THIS EVENT
      const existingUserBooking = await Booking.findOne({
        event: eventId,
        sessionId: sessionId,
        date: { $gte: startOfDay, $lte: endOfDay },
        time: time,
        status: 'pending',
        expiresAt: { $gt: new Date() } // MUST be not expired
      });

      if (existingUserBooking) {
        console.log(`♻️ Found active session for user (SessionID: ${sessionId}). Returning existing booking.`);
        console.log(`   - Existing Expiry: ${existingUserBooking.expiresAt.toISOString()}`);
        console.log(`   - Time Remaining: ${Math.floor((existingUserBooking.expiresAt - Date.now()) / 1000)}s`);

        return res.status(200).json({
          success: true,
          data: {
            bookingId: existingUserBooking._id,
            totalAmount: existingUserBooking.totalAmount,
            expiresAt: existingUserBooking.expiresAt,
            bookingReference: existingUserBooking.bookingReference
          },
          message: 'Restored active booking session'
        });
      } else {
        // DEBUG: Check if it exists but failed strict match
        const softMatch = await Booking.findOne({
          event: eventId,
          sessionId: sessionId,
          status: 'pending',
          expiresAt: { $gt: new Date() }
        });
        if (softMatch) {
          console.log(`⚠️ FOUND PARTIAL MATCH (Session+Event) BUT FAILED STRICT MATCH:`);
          console.log(`   - Input Date: ${new Date(date).toISOString()}, DB Date: ${softMatch.date.toISOString()}`);
          console.log(`   - Input Time: ${time}, DB Time: ${softMatch.time}`);
        } else {
          console.log(`❌ No active session found for SessionID: ${sessionId} (Strict or Soft)`);
        }
      }

      // Count existing bookings (confirmed + pending not expired)
      const existingBookings = await Booking.find({
        event: eventId,
        date: new Date(date),
        time: time,
        $or: [
          { status: 'confirmed' },
          { status: 'pending', expiresAt: { $gt: new Date() } }
        ]
      });

      // Count total tickets from existing bookings
      const bookedTickets = existingBookings.reduce((sum, b) => {
        const count = (b.tickets?.length || ((b.adults || 0) + (b.children || 0)));
        if (b.status === 'pending') {
          console.log(`   🔸 Pending Booking (${b._id}): ${count} tickets, Expires: ${new Date(b.expiresAt).toLocaleTimeString()}`);
        }
        return sum + count;
      }, 0);

      const requestedTickets = totalTickets;
      const availableCapacity = event.capacity - bookedTickets;

      console.log(`📊 CAPACITY CHECK:`);
      console.log(`   - Total Capacity: ${event.capacity}`);
      console.log(`   - Already Booked/Held: ${bookedTickets}`);
      console.log(`   - Requested: ${requestedTickets}`);
      console.log(`   - Remaining: ${availableCapacity}`);

      if (requestedTickets > availableCapacity) {
        console.log('❌ Not enough capacity');
        return res.status(400).json({
          success: false,
          message: `Not enough capacity. Available: ${availableCapacity}, Requested: ${requestedTickets}`,
          availableCapacity
        });
      }

      // Calculate amount for walking event
      const basePrice = event.price || 0;
      let adultPrice = basePrice;
      let childPrice = basePrice;

      // Apply child discount
      if (event.childDiscountPercentage > 0) {
        childPrice = basePrice * (1 - (event.childDiscountPercentage / 100));
      }

      let subTotal = (adults * adultPrice) + (children * childPrice);

      // Apply foreigner increase
      if (isForeigner && event.foreignerIncreasePercentage > 0) {
        subTotal = subTotal * (1 + (event.foreignerIncreasePercentage / 100));
      }

      calculatedTotalAmount = Math.round(subTotal); // Ensure integer/rounded value if needed, or keep decimals? Razorpay expects paise usually but we store rupees. Let's keep rupees.

      console.log(`✓ Capacity validation passed for walking event. Calculated Amount: ${calculatedTotalAmount}`);
    }

    // Only check seat layout / seated pricing if seats are provided
    if (seats && seats.length > 0) {
      const seatLayout = await ShowSeatLayout.findOne({
        event_id: eventId,
        date: new Date(date),
        time: time,
        language: language || ''
      });

      if (seatLayout) {
        const seatIds = seats.map(s => s.seatId);
        const unavailableSeats = [];

        // Check seat availability
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

        // Check for existing pending bookings
        const existingPendingBookings = await Booking.find({
          event: eventId,
          date: new Date(date),
          time: time,
          status: 'pending',
          expiresAt: { $gt: new Date() }
        });

        for (const pendingBooking of existingPendingBookings) {
          const conflictingSeats = pendingBooking.seats
            .filter(s => seatIds.includes(s.seatId))
            .map(s => s.seatId);

          if (conflictingSeats.length > 0) {
            return res.status(400).json({
              success: false,
              message: 'Some seats are currently locked by another user',
              conflictingSeats
            });
          }
        }

        // Lock seats in the layout using the proper method
        const lockResult = await seatLayout.lockSeats(seatIds, sessionId);
        if (lockResult && lockResult.success) {
          console.log(`✓ Locked ${seatIds.length} seats in layout with timestamps`);
          // Get verified seats from DB
          const selectedSeats = seatLayout.layout_data.filter(s => seatIds.includes(s.seatId));
          // Use these trusted seats for the booking
          // We attach them to the request body or a local variable to be used later
          req.trustedSeats = selectedSeats;

          // Calculate amount using backend pricing rules (row/date/time)
          const showDate = new Date(date);
          calculatedTotalAmount = computeSeatedTotalAmount({
            event,
            date: showDate,
            time,
            seats: selectedSeats,
            adults,
            children,
            isForeigner,
            isSpecial: event.isSpecial || false,
          });

          console.log(`✓ Calculated Amount from Seats (backend rules): ${calculatedTotalAmount} (Adults: ${adults}, Children: ${children}, Foreigner: ${isForeigner})`);
        } else {
          console.error('Failed to lock seats:', lockResult);
          return res.status(400).json({
            success: false,
            message: 'Failed to lock seats',
            conflicted: lockResult?.conflicted || []
          });
        }

      } else {
        console.log('No seat layout found - proceeding without locking');
      }
    }

    // ===== CREATE TEMP BOOKING (NO TICKETS YET) =====
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Clean seat data - use Trusted Seats from DB if available (Secure), else fallback to request (Insecure but fallback)
    const seatsSource = req.trustedSeats || seats || [];
    const cleanedSeats = seatsSource.map(seat => ({
      seatId: seat.seatId,
      row: seat.row,
      number: seat.number,
      section: seat.section,
      category: seat.category,
      price: seat.price,
      status: seat.status,
      coords: seat.coords
    }));

    const booking = await Booking.create({
      bookingReference: bookingReference,
      event: eventId,
      date: new Date(date),
      time,
      language: language || 'none',
      seats: cleanedSeats,
      tickets: [],
      adults: adults || 0,
      children: children || 0,
      isForeigner: isForeigner || false,
      totalAmount: calculatedTotalAmount,
      user: userId,
      deviceId,
      sessionId,
      ipAddress,
      userAgent,
      paymentMethod,
      expiresAt,
      status: 'pending',
      paymentStatus: 'pending',
      bookingType: 'user'
    });

    console.log('✓ Created temp booking:', booking.bookingReference, 'ID:', booking._id);

    // Schedule auto-release
    setTimeout(async () => {
      await releaseExpiredBooking(booking._id);
    }, 10 * 60 * 1000);

    res.json({
      success: true,
      message: 'Temporary booking created successfully',
      data: {
        bookingId: booking._id,
        // bookingReference: booking.bookingReference,
        totalAmount: booking.totalAmount,
        expiresAt: booking.expiresAt,
        expiresIn: 600
      }
    });

  } catch (error) {
    console.error('Create temp booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create temporary booking',
      error: error.message
    });
  }
};

// Create temporary booking for partners (user-based locking, not IP-based)
exports.createTempBookingPartner = async (req, res) => {
  try {
    const {
      eventId,
      date,
      time,
      language,
      seats,
      adults,
      children,
      isForeigner,
      deviceId,
      sessionId,
      paymentMethod
    } = req.body;

    // Calculate total amount on backend
    let calculatedTotalAmount = 0;

    console.log('=== CREATE TEMP BOOKING PARTNER STARTED ===');

    // Validation
    if (!eventId || !date || !time) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields (eventId, date, time)'
      });
    }

    // Compute total tickets
    const totalTickets = (adults || 0) + (children || 0);

    // Enforce max 10 tickets for partner bookings
    if (totalTickets > 10) {
      return res.status(400).json({ success: false, message: 'Maximum 10 tickets allowed per booking' });
    }

    // Get partner ID from authenticated session
    const partnerId = req.partner?._id || null;
    if (!partnerId) {
      return res.status(401).json({ success: false, message: 'Partner authentication required' });
    }

    // ✅ Enforce "10 max at a time" cumulative limit for the partner across this event/date/time
    const existingPartnerPendingBookings = await Booking.find({
      partner: partnerId,
      event: eventId,
      date: new Date(date),
      time: time,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    });

    const pendingTicketsCount = existingPartnerPendingBookings.reduce((sum, b) => {
      const count = (b.tickets?.length || ((b.adults || 0) + (b.children || 0)));
      return sum + count;
    }, 0);

    if (pendingTicketsCount + totalTickets > 10) {
      return res.status(400).json({
        success: false,
        message: `Total pending tickets for this event cannot exceed 10. You already have ${pendingTicketsCount} tickets pending.`
      });
    }

    // Get user ID from authenticated partner
    const userId = req.user?._id || null;

    // Get IP and user agent (for logging only, not for validation)
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Check if event exists
    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // ===== VALIDATE REQUESTED DATE / TIME / LANGUAGE AGAINST EVENT SCHEDULE =====
    // Parse date as local date to avoid timezone shifts when only YYYY-MM-DD is provided
    const [yStr, mStr, dStr] = String(date).split('-');
    const reqDate = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1, parseInt(dStr, 10));
    if (isNaN(reqDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }

    const sameDay = (d1, d2) => {
      const a = new Date(d1);
      const b = new Date(d2);
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    };

    // Validate language parameter - only allow null/none, 'hi' or 'en'
    const langInput = typeof language === 'string' ? language.toLowerCase() : language;
    const allowedLangs = [undefined, null, 'none', 'hi', 'en'];
    if (!allowedLangs.includes(langInput)) {
      return res.status(400).json({ success: false, message: 'Invalid language. Allowed values: none, hi, en' });
    }

    // Normalize language for matching: treat 'none' as null/undefined
    const lang = (langInput === 'none' ? null : langInput);

    let timeLangAvailable = false;
    let matchedSlot = null; // keep matched slot for extra checks
    try {
      if (event.recurrence === 'daily') {
        if (!event.dailySchedule) timeLangAvailable = false;
        else {
          const { startDate, endDate, timeSlots } = event.dailySchedule;

          const checkDate = new Date(reqDate);
          checkDate.setHours(0, 0, 0, 0);

          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);

          const end = new Date(endDate);
          end.setHours(0, 0, 0, 0);

          if (checkDate < start || checkDate > end) {
            timeLangAvailable = false;
          } else {
            // Find a slot that matches both time and language rules
            const found = (timeSlots || []).find(ts => {
              if (ts.time !== time) return false;
              if (ts.isLangAvailable) {
                // slot expects a language; require exact match
                return ts.lang === lang;
              }
              // slot does not support language; only match if no language provided
              return !lang;
            });
            if (found) {
              matchedSlot = found;
              timeLangAvailable = true;
            } else {
              timeLangAvailable = false;
            }
          }
        }
      } else if (event.recurrence === 'specific') {
        const match = (event.specificSchedules || []).find(s => sameDay(s.date, reqDate));
        if (!match) timeLangAvailable = false;
        else {
          const found = (match.timeSlots || []).find(ts => {
            if (ts.time !== time) return false;
            if (ts.isLangAvailable) return ts.lang === lang;
            return !lang;
          });
          if (found) {
            matchedSlot = found;
            timeLangAvailable = true;
          } else {
            timeLangAvailable = false;
          }
        }
      } else {
        // unknown recurrence, be conservative
        timeLangAvailable = false;
      }
    } catch (err) {
      console.error('Schedule validation error:', err);
      timeLangAvailable = false;
    }

    if (!timeLangAvailable) {
      // If a slot exists for the time but only without language, provide clearer message
      try {
        // check if time exists but without language support
        const timeStr = typeof time === 'string' ? time.trim() : time;
        let timeExists = false;
        if (event.recurrence === 'daily' && event.dailySchedule) {
          timeExists = (event.dailySchedule.timeSlots || []).some(ts => (ts.time || '').trim() === timeStr);
        } else if (event.recurrence === 'specific') {
          const match = (event.specificSchedules || []).find(s => sameDay(s.date, reqDate));
          timeExists = match ? (match.timeSlots || []).some(ts => (ts.time || '').trim() === timeStr) : false;
        }
        if (timeExists) {
          return res.status(400).json({ success: false, message: 'Selected event language or seat does not exists' });
        }
      } catch (err) {
        // ignore and fall back
      }
      return res.status(400).json({ success: false, message: 'Selected date/time is not available for this event' });
    }

    // ===== ENFORCE 30-MINUTE CUTOFF: bookings only allowed if current time is at least 30 minutes before event start =====
    try {
      const timeStr = typeof time === 'string' ? time.trim() : time;
      if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(timeStr)) {
        return res.status(400).json({ success: false, message: 'Invalid event time format' });
      }
      const [hourStr, minStr] = timeStr.split(':');
      const eventDateTime = new Date(reqDate);
      eventDateTime.setHours(parseInt(hourStr, 10), parseInt(minStr, 10), 0, 0);

      const now = new Date();
      const diffMs = eventDateTime - now;
      const cutoffMs = 30 * 60 * 1000; // 30 minutes

      if (diffMs <= 0) {
        return res.status(400).json({ success: false, message: 'Cannot book for past event times' });
      }

      if (diffMs < cutoffMs) {
        return res.status(400).json({ success: false, message: 'Bookings close 30 minutes before the event start. Please select an earlier time or date' });
      }
    } catch (err) {
      console.error('Event time parsing error:', err);
      return res.status(400).json({ success: false, message: 'Invalid event time format' });
    }

    // ===== GENERATE BOOKING REFERENCE (TEMP FORMAT) =====
    const bookingReference = `ID-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`;
    console.log('Generated temp booking reference:', bookingReference);

    // ===== CAPACITY VALIDATION FOR WALKING EVENTS =====
    if (event.type === 'walking') {
      console.log('Walking event detected - validating capacity');

      // Count existing bookings (confirmed + pending not expired)
      const existingBookings = await Booking.find({
        event: eventId,
        date: new Date(date),
        time: time,
        $or: [
          { status: 'confirmed' },
          { status: 'pending', expiresAt: { $gt: new Date() } }
        ]
      });

      // Count total tickets from existing bookings
      const bookedTickets = existingBookings.reduce((sum, b) => {
        const count = (b.tickets?.length || ((b.adults || 0) + (b.children || 0)));
        return sum + count;
      }, 0);

      const requestedTickets = totalTickets;
      const availableCapacity = event.capacity - bookedTickets;

      if (requestedTickets > availableCapacity) {
        return res.status(400).json({
          success: false,
          message: `Not enough capacity. Available: ${availableCapacity}, Requested: ${requestedTickets}`,
          availableCapacity
        });
      }

      // Calculate amount for walking event
      const basePrice = event.price || 0;
      let adultPrice = basePrice;
      let childPrice = basePrice;

      if (event.childDiscountPercentage > 0) {
        childPrice = basePrice * (1 - (event.childDiscountPercentage / 100));
      }

      let subTotal = (adults * adultPrice) + (children * childPrice);

      if (isForeigner && event.foreignerIncreasePercentage > 0) {
        subTotal = subTotal * (1 + (event.foreignerIncreasePercentage / 100));
      }

      calculatedTotalAmount = Math.round(subTotal);
      console.log(`✓ Capacity validation passed for walking event. Calculated Amount: ${calculatedTotalAmount}`);
    }

    // Only check seat layout / seated pricing if seats are provided (for seated events)
    if (seats && seats.length > 0) {
      // ✅ Validate seat count matches tickets
      if (seats.length !== totalTickets) {
        return res.status(400).json({
          success: false,
          message: `Mismatch: You selected ${seats.length} seats but requested ${totalTickets} tickets (Adults: ${adults || 0}, Children: ${children || 0})`
        });
      }

      const seatLayout = await ShowSeatLayout.findOne({
        event_id: eventId,
        date: new Date(date),
        time: time,
        language: language || ''
      });

      if (seatLayout) {
        const seatIds = seats.map(s => s.seatId);
        const unavailableSeats = [];

        // Check seat availability
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

        // Check for existing pending bookings
        const existingPendingBookings = await Booking.find({
          event: eventId,
          date: new Date(date),
          time: time,
          status: 'pending',
          expiresAt: { $gt: new Date() }
        });

        for (const pendingBooking of existingPendingBookings) {
          const conflictingSeats = pendingBooking.seats
            .filter(s => seatIds.includes(s.seatId))
            .map(s => s.seatId);

          if (conflictingSeats.length > 0) {
            return res.status(400).json({
              success: false,
              message: 'Some seats are currently locked by another user',
              conflictingSeats
            });
          }
        }

        // ✅ Lock seats using userId or sessionId
        const lockSessionId = userId?.toString() || sessionId || deviceId || uuidv4();
        const lockResult = await seatLayout.lockSeats(seatIds, lockSessionId);
        if (lockResult && lockResult.success) {
          console.log(`✓ Locked ${seatIds.length} seats for partner user ${userId}`);

          // Re-resolve seats from DB for pricing
          const selectedSeats = seatLayout.layout_data.filter(s => seatIds.includes(s.seatId));
          const showDate = new Date(date);

          // Compute backend-authoritative amount
          calculatedTotalAmount = computeSeatedTotalAmount({
            event,
            date: showDate,
            time,
            seats: selectedSeats,
            adults,
            children,
            isForeigner,
            isSpecial: event.isSpecial || false,
          });

          console.log(`✓ Partner calculated Amount from Seats (backend rules): ${calculatedTotalAmount}`);
          req.trustedSeats = selectedSeats; // Store for booking creation
        } else {
          return res.status(400).json({
            success: false,
            message: 'Failed to lock seats',
            conflicted: lockResult?.conflicted || []
          });
        }
      } else {
        console.log('No show seat layout found - fetching template for metadata');
        // Fetch template only for metadata (coords, price)
        const templateLayout = await SeatLayout.findOne({ event_id: eventId });
        if (!templateLayout) {
          return res.status(400).json({
            success: false,
            message: 'Seat layout not configured for this event'
          });
        }

        const seatIds = seats.map(s => s.seatId);
        // We cannot lock, but we must validate existence and get Coords/Price
        const selectedSeats = templateLayout.layout_data.filter(s => seatIds.includes(s.seatId));

        if (selectedSeats.length !== seatIds.length) {
          return res.status(400).json({ success: false, message: 'Invalid seat IDs provided' });
        }

        console.log(`✓ Retrieved ${selectedSeats.length} seats from template for metadata`);

        // Calculate amount
        const showDate = new Date(date);
        calculatedTotalAmount = computeSeatedTotalAmount({
          event,
          date: showDate,
          time,
          seats: selectedSeats,
          adults,
          children,
          isForeigner,
          isSpecial: event.isSpecial || false,
        });

        // Use these as trusted seats (metadata only, no locking status)
        // We must override status to 'booked' or 'pending' later, but for now just pass data
        req.trustedSeats = selectedSeats.map(s => ({
          ...s.toObject ? s.toObject() : s,
          status: 'available' // They were from template, so nominally available
        }));
      }
    } else if (event.type === 'configure') {
      // Seated event but no seats provided
      return res.status(400).json({
        success: false,
        message: 'Seats are required for this event type'
      });
    }

    // ===== CREATE TEMP BOOKING (NO TICKETS YET) =====
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Clean seat data - use Trusted Seats from DB if available
    const seatsSource = req.trustedSeats || seats || [];
    const cleanedSeats = seatsSource.map(seat => ({
      seatId: seat.seatId,
      row: seat.row,
      number: seat.number,
      section: seat.section,
      category: seat.category,
      price: seat.price,
      status: seat.status,
      coords: seat.coords
    }));

    const booking = await Booking.create({
      bookingReference: bookingReference,
      event: eventId,
      date: new Date(date),
      time,
      language: language || 'none',
      seats: cleanedSeats,
      tickets: [],
      adults: adults || 0,
      children: children || 0,
      isForeigner: isForeigner || false,
      totalAmount: calculatedTotalAmount,
      user: userId,
      deviceId: deviceId || null,
      sessionId: sessionId || null,
      ipAddress,
      userAgent,
      paymentMethod,
      expiresAt,
      status: 'pending',
      paymentStatus: 'pending',
      bookingType: 'partner',
      partner: req.partner?._id || null
    });

    console.log('✓ Created temp booking:', booking.bookingReference, 'ID:', booking._id);

    // Schedule auto-release
    setTimeout(async () => {
      await releaseExpiredBooking(booking._id);
    }, 10 * 60 * 1000);

    res.json({
      success: true,
      message: 'Temporary booking created successfully',
      data: {
        bookingId: booking._id,
        // bookingReference: booking.bookingReference,
        totalAmount: booking.totalAmount,
        expiresAt: booking.expiresAt,
        expiresIn: 600
      }
    });

  } catch (error) {
    console.error('Create temp booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create temporary booking',
      error: error.message
    });
  }
};

// ✅ Updated release function for unified model
async function releaseExpiredBooking(bookingId) {
  try {
    const booking = await Booking.findById(bookingId);
    if (!booking || booking.status !== 'pending') return;

    console.log(`Releasing expired booking: ${booking.bookingReference}`);

    // Release seats if locked
    if (booking.seats && booking.seats.length > 0) {
      const showDate = booking.date instanceof Date ? booking.date : new Date(booking.date);
      const seatLayout = await ShowSeatLayout.findOne({
        event_id: booking.event,
        date: showDate,
        time: booking.time,
        language: booking.language || ''
      });

      if (seatLayout) {
        const seatIds = booking.seats.map(s => s.seatId);
        console.log(`Releasing seats: ${seatIds.join(', ')}`);

        // Use the proper unlock method
        const unlockResult = await seatLayout.unlockSeats(seatIds, booking.sessionId);
        if (unlockResult && unlockResult.success) {
          console.log(`✅ Released ${seatIds.length} seats for booking ${booking.bookingReference}`);
        } else {
          console.error(`❌ Failed to release seats for booking ${booking.bookingReference}`);
        }
      } else {
        console.log(`No seat layout found for booking ${booking.bookingReference}`);
      }
    }

    booking.status = 'expired';
    await booking.save();

    console.log(`✅ Released expired booking: ${booking.bookingReference}`);
  } catch (error) {
    console.error('Error releasing booking:', error);
  }
}

// ✅ Cleanup expired seat locks in all ShowSeatLayouts
async function cleanupExpiredSeatLocks() {
  try {
    console.log('🧹 Starting cleanup of expired seat locks...');

    const result = await ShowSeatLayout.cleanupAllExpiredLocks(10);

    if (result && result.success) {
      console.log(`✅ Seat lock cleanup completed: ${result.processedLayouts} layouts processed`);
    } else {
      console.error('❌ Seat lock cleanup failed:', result?.error);
    }
  } catch (error) {
    console.error('❌ Seat lock cleanup error:', error);
  }
}

// ✅ Cleanup expired bookings
exports.cleanupExpiredBookings = async () => {
  try {
    console.log('🧹 Starting cleanup of expired bookings...');

    const expiredBookings = await Booking.find({
      status: 'pending',
      expiresAt: { $lt: new Date() }
    });

    console.log(`Found ${expiredBookings.length} expired bookings to clean up`);

    for (const booking of expiredBookings) {
      await releaseExpiredBooking(booking._id);
    }

    await cleanupExpiredSeatLocks();

    console.log(`✅ Cleanup completed: ${expiredBookings.length} expired bookings processed`);
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
};

// ✅ Test endpoint to manually trigger cleanup
exports.testCleanup = async (req, res) => {
  try {
    console.log('🧪 Manual test cleanup triggered');
    await exports.cleanupExpiredBookings();
    res.json({
      success: true,
      message: 'Test cleanup completed - check server logs for details',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Test cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Test cleanup failed',
      error: error.message
    });
  }
};