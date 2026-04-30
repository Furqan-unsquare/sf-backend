const Booking = require('../models/Booking');
const ShowSeatLayout = require('../models/ShowSeatLayout');
const redis = require('../config/redis');

// Booking expiration window in seconds (1 minute)
const BOOKING_EXPIRATION = 30 * 60;

// Redis sorted-set key that holds booking expirations (score = expiry timestamp ms)
const EXPIRATIONS_KEY = 'bookings:expirations';

/**
 * Schedule a booking for expiration by adding to a sorted-set with expiry timestamp.
 */
const scheduleBookingExpiration = async (bookingId) => {
    try {
        const expireAt = Date.now() + BOOKING_EXPIRATION * 1000; // ms
        await redis.zadd(EXPIRATIONS_KEY, expireAt, bookingId);
        return true;
    } catch (error) {
        console.error('❌ Error scheduling booking expiration:', error);
        return false;
    }
};

/**
 * Process an expired booking by marking cancelled and releasing seats.
 */
const processExpiredBooking = async (bookingId) => {
    try {
        const booking = await Booking.findById(bookingId);
        if (!booking || booking.status !== 'pending') {
            console.log(`Booking ${bookingId} not found or already processed`);
            return;
        }

        console.log(`🔄 Processing expired booking: ${booking.bookingReference}`);

        booking.status = 'cancelled';
        booking.paymentStatus = 'cancelled';
        booking.expiresAt = new Date();
        await booking.save();

        if (booking.seats?.length > 0) {
            const seatLayout = await ShowSeatLayout.findOne({
                event_id: booking.event,
                date: booking.date,
                time: booking.time,
                language: booking.language || ''
            });

            if (seatLayout) {
                const seatIds = booking.seats.map(seat => seat.seatId);
                await seatLayout.releaseSeats(seatIds, 'bulk');
                console.log(`✅ Released ${seatIds.length} seats for booking ${booking.bookingReference}`);
            }
        }

        console.log(`✅ Successfully processed expired booking: ${booking.bookingReference}`);
        return true;
    } catch (error) {
        console.error(`❌ Error processing expired booking ${bookingId}:`, error);
        return false;
    }
};

/**
 * Check sorted-set for bookings whose expiry timestamp <= now and process them.
 */
const checkForExpiredBookings = async () => {
    try {
        const now = Date.now();
        const expired = await redis.zrangebyscore(EXPIRATIONS_KEY, 0, now);

        if (!expired || expired.length === 0) {
            return { success: true, processed: 0 };
        }

        for (const bookingId of expired) {
            try {
                await processExpiredBooking(bookingId);
            } catch (err) {
                console.error(`Error processing booking ${bookingId}:`, err);
            }
            await redis.zrem(EXPIRATIONS_KEY, bookingId);
        }

        return { success: true, processed: expired.length };
    } catch (error) {
        console.error('❌ Error in checkForExpiredBookings:', error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    scheduleBookingExpiration,
    checkForExpiredBookings,
    processExpiredBooking
};
