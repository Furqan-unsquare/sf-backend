const mongoose = require('mongoose');
const User = require('../models/User');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const seedEventStaff = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Connected to MongoDB');

        const email = 'eventstaff@gmail.com';
        const password = '123456789';

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log('Event-Staff user already exists');
            process.exit(0);
        }

        const eventStaff = new User({
            name: 'Event Staff User',
            email: email,
            password: password,
            role: 'Event-Staff',
            isActive: true,
        });

        await eventStaff.save();
        console.log('Event-Staff user created successfully:');
        console.log('Email:', email);
        console.log('Password:', password);

        process.exit(0);
    } catch (error) {
        console.error('Error seeding Event-Staff user:', error);
        process.exit(1);
    }
};

seedEventStaff();
