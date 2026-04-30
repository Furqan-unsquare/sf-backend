const SeatLock = require('../models/SeatLock');
const SeatLayout = require('../models/SeatLayout');
const Booking = require('../models/Booking');
const { v4: uuidv4 } = require('uuid');

// Lock seats for manual booking (30 minutes)
exports.lockSeats = async (req, res) => {
  try {
    const { eventId, date, time, language, seats, userId, lockDuration = 1800 } = req.body;

    if (!eventId || !date || !time || !seats || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: eventId, date, time, seats, userId'
      });
    }

    // Check if seats are already locked or booked
    const seatLayout = await SeatLayout.findOne({ event_id: eventId });
    if (!seatLayout) {
      return res.status(404).json({
        success: false,
        message: 'Seat layout not found for this event'
      });
    }

    // Check existing bookings for these seats
    const existingBookings = await Booking.find({
      event: eventId,
      date: new Date(date),
      time,
      language,
      status: { $in: ['confirmed', 'pending', 'active'] },
      'seats.seatId': { $in: seats }
    });

    if (existingBookings.length > 0) {
      const bookedSeats = existingBookings.flatMap(b => b.seats.map(s => s.seatId));
      const conflictSeats = seats.filter(s => bookedSeats.includes(s));
      return res.status(409).json({
        success: false,
        message: 'Some seats are already booked',
        conflictSeats
      });
    }

    // Check existing active locks
    const existingLocks = await SeatLock.find({
      eventId,
      date: new Date(date),
      time,
      language,
      status: 'active',
      expiresAt: { $gt: new Date() },
      seats: { $in: seats }
    });

    if (existingLocks.length > 0) {
      const lockedSeats = existingLocks.flatMap(l => l.seats);
      const conflictSeats = seats.filter(s => lockedSeats.includes(s));
      return res.status(409).json({
        success: false,
        message: 'Some seats are already locked by another user',
        conflictSeats
      });
    }

    // Create new seat lock
    const lockId = uuidv4();
    const expiresAt = new Date(Date.now() + lockDuration * 1000);

    const seatLock = new SeatLock({
      lockId,
      eventId,
      date: new Date(date),
      time,
      language,
      seats,
      userId,
      lockDuration,
      expiresAt,
      status: 'active'
    });

    await seatLock.save();

    // Update seat layout to mark seats as locked
    const updatePromises = seats.map(seatId => {
      return SeatLayout.updateOne(
        { 
          event_id: eventId,
          'layout_data.seatId': seatId
        },
        { 
          $set: { 
            'layout_data.$.status': 'locked',
            'layout_data.$.lockedBy': userId,
            'layout_data.$.lockedAt': new Date(),
            'layout_data.$.lockExpiresAt': expiresAt
          } 
        }
      );
    });

    await Promise.all(updatePromises);

    res.status(201).json({
      success: true,
      message: 'Seats locked successfully',
      data: {
        lockId: seatLock._id,
        expiresAt,
        duration: lockDuration
      }
    });
  } catch (error) {
    console.error('Error locking seats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to lock seats',
      error: error.message
    });
  }
};