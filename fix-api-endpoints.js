const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'Frontend', 'src', 'Partner', 'data', 'apiEndpoints.json');
const content = fs.readFileSync(filePath, 'utf8');
const data = JSON.parse(content);

// Fix 1: Add totalAmount to temp booking response
const tempBooking = data.find(item => item.id === 'create-temp-booking');
if (tempBooking && tempBooking.response && tempBooking.response['200']) {
    tempBooking.response['200'].example.data.totalAmount = 1499;
    console.log('✅ Added totalAmount to temp booking response');
}

// Fix 2: Change amount format in create-order response
const createOrder = data.find(item => item.id === 'create-order');
if (createOrder && createOrder.response && createOrder.response['200']) {
    createOrder.response['200'].example.data.amount = "998.00";
    console.log('✅ Changed amount format to decimal in create-order');
}

// Fix 3: Update verify-configure-payment to use tempBookingId (NOT eventId)
const verifyConfig = data.find(item => item.id === 'verify-configure-payment');
if (verifyConfig) {
    // Update request body - remove eventId, date, time, language, adults, children
    verifyConfig.requestBody = {
        "tempBookingId": "string (required - this is the bookingId from temp booking response)",
        "orderId": "string (required)",
        "paymentId": "string (required)",
        "paymentSuccess": "boolean (required)",
        "paymentProvider": "string (required, e.g., 'razorpay')",
        "isForeigner": "boolean (optional)",
        "contactInfo": {
            "name": "string (required)",
            "phone": "string (required)",
            "email": "string (required)",
            "altPhone": "string (optional)"
        },
        "specialNotes": "string (optional)"
    };

    // Update example request body
    verifyConfig.exampleRequestBody = {
        "tempBookingId": "6929747a1225c8fb571c8229",
        "orderId": "order_Rl8525HsOsZUk6",
        "paymentId": "pay_Rl528gcoLd3oFc",
        "paymentSuccess": true,
        "paymentProvider": "razorpay",
        "isForeigner": false,
        "contactInfo": {
            "name": "Developer",
            "phone": "+91 9876543210",
            "email": "developer@gmail.com",
            "altPhone": ""
        }
    };

    console.log('✅ Updated verify-configure-payment to use tempBookingId only');
}

// Write back to file
fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
console.log('\n✅ Successfully updated apiEndpoints.json');
console.log('\nKey changes:');
console.log('1. Added totalAmount to temp booking response');
console.log('2. Changed payment order amount to decimal format (998.00)');
console.log('3. Updated verify payment to ONLY use tempBookingId (removed eventId, date, time, language, adults, children)');
console.log('\nNote: tempBookingId is the bookingId from the temp booking creation response');
