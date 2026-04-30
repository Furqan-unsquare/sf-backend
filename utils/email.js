// // utils/email.js
// const nodemailer = require('nodemailer');

// const transporter = nodemailer.createTransport({
//   host: process.env.EMAIL_HOST || 'smtp.gmail.com', // e.g., smtp.gmail.com for Gmail
//   port: process.env.EMAIL_PORT || 587,
//   secure: false, // true for 465, false for other ports
//   auth: {
//     user: process.env.EMAIL_USER, // Your email (e.g., your@gmail.com)
//     pass: process.env.EMAIL_PASS // App password (not regular password)
//   }
// });

// // Test transporter on startup (optional, for debugging)
// transporter.verify((error, success) => {
//   if (error) {
//     console.error('Email transporter error:', error);
//   } else {
//     console.log('Email transporter ready');
//   }
// });

// const sendEmail = async (to, subject, html) => {
//   const mailOptions = {
//     from: process.env.EMAIL_USER,
//     to,
//     subject,
//     html
//   };

//   try {
//     const info = await transporter.sendMail(mailOptions);
//     console.log('Email sent:', info.messageId);
//     return info;
//   } catch (error) {
//     console.error('Email send error:', error);
//     throw error;
//   }
// };

// module.exports = { sendEmail };