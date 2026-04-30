const AdminLog = require('../models/AdminLog');
const User = require('../models/User');

// Get all logs with filtering and pagination
exports.getAllLogs = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            action,
            resource,
            search,
            startDate,
            endDate,
            role // Added role parameter
        } = req.query;

        const query = {};

        // Filters
        if (action) query.action = action;
        if (resource) query.resource = resource;

        // Role Filter
        if (role) {
            const usersWithRole = await User.find({ role: role }).select('_id');
            const userIds = usersWithRole.map(u => u._id);
            query.admin = { $in: userIds };
        }

        // Date Range
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        // Search
        if (search) {
            query.$or = [
                { resourceId: { $regex: search, $options: 'i' } },
                { 'details.body.name': { $regex: search, $options: 'i' } },
                { 'details.body.title': { $regex: search, $options: 'i' } }
            ];
        }

        const logs = await AdminLog.find(query)
            .populate('admin', 'name email role')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        const total = await AdminLog.countDocuments(query);

        res.json({
            success: true,
            data: {
                logs,
                pagination: {
                    totalCount: total,
                    totalPages: Math.ceil(total / limit),
                    currentPage: parseInt(page)
                }
            }
        });
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch logs'
        });
    }
};
