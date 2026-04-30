/**
 * Run with:
 * node seeds/seedAdmin.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

// 🔹 ENV CONFIG
const MONGO_URI = process.env.MONGODB_URI;
const ADMIN_NAME = 'Sabhyata Foundation';
const ADMIN_EMAIL = 'Tondak.Sunil@sabhyata.co.in';
const ADMIN_PASSWORD = 'Tondak@123';
const ADMIN_PHONE = '1234567899';

async function seedAdmin() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ MongoDB connected');

    // 🔹 Check if admin already exists
    let admin = await User.findOne({ email: ADMIN_EMAIL });

    if (admin) {
      console.log('⚠️ Admin already exists. Updating details...');

      admin.name = ADMIN_NAME;
      admin.password = ADMIN_PASSWORD; // will be hashed by pre-save hook
      admin.role = 'admin';
      admin.phone = ADMIN_PHONE;
      admin.isActive = true;
      admin.isBlocked = false;

      await admin.save();
    } else {
      admin = await User.create({
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD, // hashed automatically
        role: 'admin',
        phone: ADMIN_PHONE,
        isActive: true,
        isBlocked: false
      });
    }

    console.log('✅ Admin seeded successfully');
    console.log({
      id: admin._id.toString(),
      email: admin.email,
      role: admin.role
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Admin seeding failed:', error.message);
    process.exit(1);
  }
}

seedAdmin();
