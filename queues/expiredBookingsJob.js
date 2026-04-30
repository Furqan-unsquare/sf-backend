// In expiredBookingsJob.js
const cron = require('node-cron');
const { checkForExpiredBookings } = require('../utils/bookingExpiration');
const redis = require('../config/redis');

const startExpiredBookingsJob = () => {
    console.log('🚀 Starting Redis-based expired bookings job...');
    
    // ioredis connects automatically, just listen for connection events
    redis.on('error', (err) => {
        console.error('❌ Redis error:', err);
    });

    redis.on('connect', () => {
        console.log('✅ Connected to Redis');
        // Initial check
        checkForExpiredBookings().catch(console.error);
    });

    // Check every 30 seconds
    const job = cron.schedule('* * * * *', async () => {
        console.log('⏰ Running expired bookings check...');
        try {
            const result = await checkForExpiredBookings();
            if (!result.success) {
                console.error('❌ Error in expired bookings job:', result.error);
            }
        } catch (error) {
            console.error('❌ Unhandled error in expired bookings job:', error);
        }
    });

    // Handle graceful shutdown
    const shutdown = async () => {
        console.log('🛑 Shutting down expired bookings job...');
        job.stop();
        redis.quit().finally(() => {
            console.log('✅ Redis connection closed');
            process.exit(0);
        });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    return {
        stop: shutdown
    };
};

module.exports = { startExpiredBookingsJob };