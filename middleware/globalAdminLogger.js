// middleware/globalAdminLogger.js
const AdminLog = require('../models/AdminLog');

// Mapping of URL segments to Mongoose Models
const URL_TO_MODEL = {
    'events': 'Event',
    'bookings': 'Booking',
    'bulk-bookings': 'Booking', // Assuming bulk bookings use Booking model
    'users': 'User',
    'monuments': 'Monument',
    'seat-layouts': 'SeatLayout',
    'abandoned-carts': 'AbandonedCart',
    'partners': 'Partner'
};

/**
 * Global Middleware to automatically log admin activities
 */
const globalAdminLogger = async (req, res, next) => {
    // 1. Skip GET requests
    if (req.method === 'GET') {
        return next();
    }

    // 2. Only log if user is admin (and authenticated)
    if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'sub-admin' && req.user.role !== 'staff')) {
        return next();
    }

    // 3. Infer Resource from URL
    // URL format: /api/admin/events/... -> extract 'events'
    // We use originalUrl because baseUrl might stop at /api/admin depending on where middleware is mounted
    const urlParts = req.originalUrl.split('?')[0].split('/');
    let resource = 'unknown';
    let ModelName = null;

    for (const part of urlParts) {
        if (URL_TO_MODEL[part]) {
            resource = part;
            ModelName = URL_TO_MODEL[part];
            break;
        }
    }

    // 4. Prepare for Diffing (Fetch Original Document)
    let originalDocument = null;
    const resourceIdParam = req.params.id || req.params.partnerId || req.params.bookingId;

    if ((req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') && resourceIdParam && ModelName) {
        try {
            const Model = require(`../models/${ModelName}`);
            originalDocument = await Model.findById(resourceIdParam).lean();
        } catch (error) {
            console.warn(`[AdminLogger] Failed to fetch original document for ${ModelName}:`, error.message);
        }
    }

    // 5. Override res.send to capture response (for ID and success status)
    const originalSend = res.send;
    res.send = function (data) {
        res.send = originalSend; // Restore immediately

        // Parse response
        let responseData;
        try {
            responseData = typeof data === 'string' ? JSON.parse(data) : data;
        } catch (e) {
            responseData = data;
        }

        // 6. Log if success
        if (res.statusCode >= 200 && res.statusCode < 300) {
            logActivity(req, responseData, resource, originalDocument).catch(err => {
                console.error('[AdminLogger] Error logging activity:', err);
            });
        }

        return originalSend.call(this, data);
    };

    next();
};

// Helper: Log Activity
async function logActivity(req, responseData, resource, originalDocument) {
    let action;
    switch (req.method) {
        case 'POST': action = 'create'; break;
        case 'PUT': case 'PATCH': action = 'update'; break;
        case 'DELETE': action = 'delete'; break;
        default: action = 'unknown';
    }

    // Determine Resource ID
    const resourceId =
        req.params.id ||
        req.params.partnerId ||
        req.params.bookingId ||
        responseData?.data?.bookingId || // Added specific check for bulk booking response
        responseData?.data?._id ||
        responseData?.data?.id ||
        responseData?._id ||
        'unknown';

    // Calculate Changes
    let changes = {};

    if (action === 'update' && originalDocument) {
        changes.diff = calculateDetailedDiff(originalDocument, req.body);
    } else if (action === 'create') {
        changes.after = sanitizeDocument(req.body);
    } else if (action === 'delete') {
        changes.deletedId = resourceId;
    }

    // Create Log Entry
    await AdminLog.create({
        admin: req.user._id,
        action,
        resource,
        resourceId: String(resourceId),
        details: {
            params: req.params,
            query: req.query,
            body: sanitizeDocument(req.body), // Store sanitized body for context
            createdByName: req.user.name,
            createdByEmail: req.user.email,
            createdByRole: req.user.role
        },
        changes,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.headers['user-agent'],
        endpoint: req.originalUrl,
        method: req.method,
        status: 'success'
    });
}

// Helper: Calculate Diff
function calculateDetailedDiff(before, after) {
    const diff = {};
    const skipFields = ['_id', '__v', 'createdAt', 'updatedAt', 'password'];
    const keysToCheck = Object.keys(after || {}).filter(key => !skipFields.includes(key));

    keysToCheck.forEach(key => {
        const oldValue = before[key];
        const newValue = after[key];

        if (isEqual(oldValue, newValue)) return;

        // Special handling for images
        if (key === 'image' && typeof oldValue === 'object' && typeof newValue === 'object') {
            if (oldValue?.base64 && newValue?.base64) return;
        }

        diff[key] = {
            from: sanitizeValue(oldValue),
            to: sanitizeValue(newValue)
        };
    });
    return diff;
}

// Helper: Deep Equality
function isEqual(val1, val2) {
    if (val1 === val2) return true;
    if (typeof val1 !== typeof val2) return false;
    if (val1 === null || val2 === null) return val1 === val2;
    if (val1 instanceof Date && val2 instanceof Date) return val1.getTime() === val2.getTime();
    if (Array.isArray(val1) && Array.isArray(val2)) return JSON.stringify(val1) === JSON.stringify(val2);
    if (typeof val1 === 'object' && typeof val2 === 'object') return JSON.stringify(val1) === JSON.stringify(val2);
    return false;
}

// Helper: Sanitize Document
function sanitizeDocument(doc) {
    if (!doc || typeof doc !== 'object') return doc;
    const sanitized = JSON.parse(JSON.stringify(doc));
    const sensitiveFields = ['password', '__v', 'token', 'secret'];

    function removeSensitive(obj) {
        if (!obj || typeof obj !== 'object') return;
        for (const key in obj) {
            if (sensitiveFields.includes(key)) delete obj[key];
            else if (key === 'image' && obj[key]?.base64) obj[key].base64 = '[BASE64_TRUNCATED]';
            else if (typeof obj[key] === 'object') removeSensitive(obj[key]);
        }
    }
    removeSensitive(sanitized);
    return sanitized;
}

// Helper: Sanitize Value
function sanitizeValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string' && value.length > 500) return value.substring(0, 500) + '... [TRUNCATED]';
    if (typeof value === 'object' && value?.base64) return { ...value, base64: '[BASE64_TRUNCATED]' };
    return value;
}

module.exports = globalAdminLogger;
