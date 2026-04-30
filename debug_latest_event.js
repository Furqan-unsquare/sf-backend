const mongoose = require('mongoose');
const Event = require('./models/Event');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://foundationsabhyata_db_user:jOZS28mshtshQ54j@cluster0.wse2uyb.mongodb.net/Production';
        const conn = await mongoose.connect(mongoUri);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

const debugLatestEvent = async () => {
    try {
        await connectDB();

        const latestEvent = await Event.findOne().sort({ createdAt: -1 });

        if (!latestEvent) {
            console.log('No events found.');
            process.exit(0);
        }

        console.log('--- LATEST EVENT DEBUG ---');
        console.log(`ID: ${latestEvent._id}`);
        console.log(`Name: ${latestEvent.name}`);
        console.log(`Type: ${latestEvent.type}`);
        console.log(`Recurrence: ${latestEvent.recurrence}`);
        console.log(`Capacity (Raw):`, latestEvent.capacity);
        console.log(`Capacity (Type):`, typeof latestEvent.capacity);
        console.log(`Configure Seats:`, latestEvent.configureSeats);

        if (latestEvent.recurrence === 'specific') {
            console.log('Specific Schedules:', JSON.stringify(latestEvent.specificSchedules, null, 2));
        } else {
            console.log('Daily Schedule:', JSON.stringify(latestEvent.dailySchedule, null, 2));
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

debugLatestEvent();
