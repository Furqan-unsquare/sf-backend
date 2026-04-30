const Booking = require('../models/Booking');
const Event = require('../models/Event');
const User = require('../models/User');
const AbandonedCart = require('../models/AbandonedCart');

// Get dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // Validate dates
    const isValidDate = (dateString) => {
      const date = new Date(dateString);
      return date instanceof Date && !isNaN(date);
    };

    // Helper to set start of day
    const startOfDay = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    // Helper to set end of day
    const endOfDay = (date) => {
      const d = new Date(date);
      d.setHours(23, 59, 59, 999);
      return d;
    };

    // Date range filter
    const dateFilter = {};
    if (startDate && endDate && isValidDate(startDate) && isValidDate(endDate)) {
      dateFilter.createdAt = {
        $gte: startOfDay(startDate),
        $lte: endOfDay(endDate)
      };
    }

    // Total revenue (only paid bookings)
    const revenueStats = await Booking.aggregate([
      {
        $match: {
          paymentStatus: 'paid',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalAmount' },
          totalBookings: { $sum: 1 }
        }
      }
    ]);

    const totalRevenue = revenueStats[0]?.totalRevenue || 0;
    const totalPaidBookings = revenueStats[0]?.totalBookings || 0;

    // Booking trends for chart
    const bookingTrends = await Booking.aggregate([
      {
        $match: {
          ...dateFilter
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }
          },
          bookings: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'paid'] }, '$totalAmount', 0]
            }
          }
        }
      },
      { $sort: { '_id.date': 1 } },
      { $limit: 30 }
    ]);

    // Sales sources
    const salesSources = await Booking.aggregate([
      {
        $match: {
          paymentStatus: 'paid',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: '$paymentMethod',
          count: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    // Partner sales stats
    const partnerStats = await Booking.aggregate([
      {
        $match: {
          paymentStatus: 'paid',
          bookingType: 'partner',
          ...dateFilter
        }
      },
      {
        $group: {
          _id: '$partner',
          count: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      },
      {
        $lookup: {
          from: 'partners',
          localField: '_id',
          foreignField: '_id',
          as: 'partnerInfo'
        }
      },
      { $unwind: { path: '$partnerInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          partnerName: { $ifNull: ['$partnerInfo.name', 'Unknown Partner'] },
          partnerId: '$_id',
          count: 1,
          revenue: 1
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    // Recent bookings
    const recentBookings = await Booking.find(dateFilter)
      .populate('event', 'title')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Additional stats - Apply same date filter logic consistently
    const [
      totalUsers,
      totalEvents,
      pendingBookings,
      abandonedCarts
    ] = await Promise.all([
      User.countDocuments({ role: 'user', ...dateFilter }),
      Event.countDocuments(dateFilter),
      Booking.countDocuments({ status: 'pending', ...dateFilter }),
      AbandonedCart.countDocuments({ status: 'active', ...dateFilter })
    ]);

    res.json({
      success: true,
      data: {
        overview: {
          totalRevenue,
          totalPaidBookings,
          totalUsers,
          totalEvents,
          pendingBookings,
          abandonedCarts
        },
        bookingTrends: bookingTrends.map(item => ({
          date: item._id.date,
          bookings: item.bookings,
          revenue: item.revenue
        })),
        salesSources: salesSources.map(item => ({
          source: item._id || 'Unknown',
          count: item.count,
          revenue: item.revenue
        })),
        partnerStats: partnerStats.map(item => ({
          name: item.partnerName,
          id: item.partnerId,
          count: item.count,
          revenue: item.revenue
        })),
        recentBookings
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message
    });
  }
};