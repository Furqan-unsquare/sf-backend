const Booking = require('../models/Booking');
const SeatLock = require('../models/SeatLock');
const Event = require('../models/Event');
const { v4: uuidv4 } = require('uuid');
const ShowSeatLayout = require('../models/ShowSeatLayout');

//* Get all pending bookings (for admin approval)
exports.getPendingBookings = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;

    const bookings = await Booking.find({
      bookingType: 'manual',
      status: 'pending',
      expiresAt: { $gt: new Date() } // Only non-expired
    })
      .populate('event', 'name venue price')
      .populate('createdBy', 'name email')
      .populate('seatLockId')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Booking.countDocuments({
      bookingType: 'manual',
      status: 'pending',
      expiresAt: { $gt: new Date() }
    });

    // Add lock expiration info
    const bookingsWithLockInfo = bookings.map(booking => {
      const bookingObj = booking.toObject();
      if (booking.seatLockId && booking.seatLockId.expiresAt) {
        bookingObj.lockExpiresAt = booking.seatLockId.expiresAt;
      }
      return bookingObj;
    });

    res.json({
      success: true,
      data: bookingsWithLockInfo,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching pending bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending bookings',
      error: error.message
    });
  }
};

//  * Approve a manual booking
exports.approveBooking = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await Booking.findById(id).populate('event');
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Booking is not pending'
      });
    }

    // ✅ Check if booking has expired
    if (booking.expiresAt && new Date() > booking.expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Booking has expired. Please create a new booking.'
      });
    }

    // ✅ Convert locked seats to permanently booked
    if (booking.seats && booking.seats.length > 0 && booking.sessionId) {
      const seatLayout = await ShowSeatLayout.findOne({
        event_id: booking.event._id,
        date: booking.date,
        time: booking.time,
        language: booking.language || ''
      });

      if (seatLayout) {
        const seatIds = booking.seats.map(s => s.seatId);
        
        // ✅ Book seats permanently (converts from locked to booked)
        const bookResult = await seatLayout.bookSeats(seatIds, booking.sessionId, 30);
        
        if (!bookResult || !bookResult.success) {
          console.error('Failed to book seats permanently:', bookResult);
          return res.status(409).json({
            success: false,
            message: 'Failed to confirm seats - they may have been taken by another user',
            conflicted: bookResult?.conflicted || []
          });
        }
        console.log(`✅ Permanently booked ${seatIds.length} seats for booking ${booking.bookingReference}`);
      }
    }

    // ✅ Update booking to confirmed with paid status
    booking.status = 'confirmed';
    booking.paymentStatus = 'paid';
    booking.approvedBy = req.user?._id || null;
    booking.approvedAt = new Date();
    booking.expiresAt = null; // Remove expiration

    await booking.save();

    res.json({
      success: true,
      message: 'Booking approved successfully. Seats are now permanently booked.',
      data: booking
    });
  } catch (error) {
    console.error('Error approving booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve booking',
      error: error.message
    });
  }
};

//* Reject a manual booking
exports.rejectBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const booking = await Booking.findById(id).populate('event');
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Booking is not pending'
      });
    }

    // ✅ Release locked seats
    if (booking.seats && booking.seats.length > 0 && booking.sessionId) {
      const seatLayout = await ShowSeatLayout.findOne({
        event_id: booking.event._id,
        date: booking.date,
        time: booking.time,
        language: booking.language || ''
      });

      if (seatLayout) {
        const seatIds = booking.seats.map(s => s.seatId);
        const unlockResult = await seatLayout.unlockSeats(seatIds, booking.sessionId, 30);
        
        if (unlockResult && unlockResult.success) {
          console.log(`✅ Released ${seatIds.length} seats after rejection`);
        } else {
          console.error('Failed to release seats:', unlockResult);
        }
      }
    }

    // ✅ Update booking status to cancelled
    booking.status = 'cancelled';
    booking.paymentStatus = 'cancelled';
    booking.rejectedBy = req.user?._id || null;
    booking.rejectedAt = new Date();
    booking.cancelReason = reason || 'Rejected by admin';

    await booking.save();

    res.json({
      success: true,
      message: 'Booking rejected successfully. Seats have been released.',
      data: booking
    });
  } catch (error) {
    console.error('Error rejecting booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject booking',
      error: error.message
    });
  }
};

// * Get bookings created by current user (for sub-admin dashboard)
exports.getMyBookings = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, startDate, endDate } = req.query;
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const query = {
      createdBy: userId,
      bookingType: 'manual'
    };

    if (status) {
      query.status = status;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const bookings = await Booking.find(query)
      .populate('event')
      .populate('approvedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Booking.countDocuments(query);

    // Get statistics
    const stats = await Booking.aggregate([
      { $match: { createdBy: userId, bookingType: 'manual' } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: bookings,
      stats,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching my bookings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bookings',
      error: error.message
    });
  }
};
