const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const fs = require('fs');

// Ensure exports directory exists
const exportsDir = path.join(__dirname, '../exports');
if (!fs.existsSync(exportsDir)) {
  fs.mkdirSync(exportsDir, { recursive: true });
}

// Export bookings to CSV
exports.exportBookings = async (bookings) => {
  const fileName = `bookings-${Date.now()}.csv`;
  const filePath = path.join(exportsDir, fileName);

  const csvWriter = createCsvWriter({
    path: filePath,
    header: [
      { id: 'bookingReference', title: 'Booking Reference' },
      { id: 'userName', title: 'User Name' },
      { id: 'userEmail', title: 'User Email' },
      { id: 'eventTitle', title: 'Event Title' },
      { id: 'totalAmount', title: 'Total Amount' },
      { id: 'totalTickets', title: 'Total Tickets' },
      { id: 'status', title: 'Status' },
      { id: 'paymentStatus', title: 'Payment Status' },
      { id: 'createdAt', title: 'Created At' }
    ]
  });

  const records = bookings.map(booking => ({
    bookingReference: booking.bookingReference,
    userName: booking.user?.name || 'N/A',
    userEmail: booking.user?.email || 'N/A',
    eventTitle: booking.event?.title || 'N/A',
    totalAmount: booking.totalAmount,
    totalTickets: booking.tickets.reduce((sum, t) => sum + t.quantity, 0),
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    createdAt: booking.createdAt.toISOString()
  }));

  await csvWriter.writeRecords(records);
  return { fileName, filePath };
};

// Export users to CSV
exports.exportUsers = async (users) => {
  const fileName = `users-${Date.now()}.csv`;
  const filePath = path.join(exportsDir, fileName);

  const csvWriter = createCsvWriter({
    path: filePath,
    header: [
      { id: 'name', title: 'Name' },
      { id: 'email', title: 'Email' },
      { id: 'role', title: 'Role' },
      { id: 'phone', title: 'Phone' },
      { id: 'isActive', title: 'Active' },
      { id: 'isBlocked', title: 'Blocked' },
      { id: 'lastLogin', title: 'Last Login' },
      { id: 'createdAt', title: 'Created At' }
    ]
  });

  const records = users.map(user => ({
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone || 'N/A',
    isActive: user.isActive,
    isBlocked: user.isBlocked,
    lastLogin: user.lastLogin ? user.lastLogin.toISOString() : 'Never',
    createdAt: user.createdAt.toISOString()
  }));

  await csvWriter.writeRecords(records);
  return { fileName, filePath };
};

// Export abandoned carts to CSV
exports.exportAbandonedCarts = async (carts) => {
  const fileName = `abandoned-carts-${Date.now()}.csv`;
  const filePath = path.join(exportsDir, fileName);

  const csvWriter = createCsvWriter({
    path: filePath,
    header: [
      { id: 'userName', title: 'User Name' },
      { id: 'userEmail', title: 'User Email' },
      { id: 'eventTitle', title: 'Event Title' },
      { id: 'totalAmount', title: 'Total Amount' },
      { id: 'totalTickets', title: 'Total Tickets' },
      { id: 'status', title: 'Status' },
      { id: 'remindersSent', title: 'Reminders Sent' },
      { id: 'createdAt', title: 'Created At' },
      { id: 'expiresAt', title: 'Expires At' }
    ]
  });

  const records = carts.map(cart => ({
    userName: cart.user?.name || 'N/A',
    userEmail: cart.user?.email || 'N/A',
    eventTitle: cart.event?.title || 'N/A',
    totalAmount: cart.totalAmount,
    totalTickets: cart.tickets.reduce((sum, t) => sum + t.quantity, 0),
    status: cart.status,
    remindersSent: cart.remindersSent,
    createdAt: cart.createdAt.toISOString(),
    expiresAt: cart.expiresAt.toISOString()
  }));

  await csvWriter.writeRecords(records);
  return { fileName, filePath };
};

// Clean up old export files
exports.cleanupOldExports = () => {
  const files = fs.readdirSync(exportsDir);
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  files.forEach(file => {
    const filePath = path.join(exportsDir, file);
    const stats = fs.statSync(filePath);
    
    if (now - stats.mtime.getTime() > oneHour) {
      fs.unlinkSync(filePath);
    }
  });
};