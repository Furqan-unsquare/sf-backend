// models/AdminLog.js
const mongoose = require('mongoose');

const adminLogSchema = new mongoose.Schema({
    admin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    action: {
        type: String,
        required: true,
        enum: ['create', 'update', 'delete']
    },
    resource: {
        type: String,
        required: true
    },
    resourceId: {
        type: String,
        required: true
    },
    details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    changes: {
        diff: { type: mongoose.Schema.Types.Mixed },
        after: { type: mongoose.Schema.Types.Mixed },
        deletedId: { type: String }
    },
    ipAddress: String,
    userAgent: String,
    endpoint: String,
    method: String,
    status: {
        type: String,
        enum: ['success', 'failed'],
        default: 'success'
    },
    errorMessage: String
}, {
    timestamps: true
});

// Indexes for efficient querying
adminLogSchema.index({ admin: 1, createdAt: -1 });
adminLogSchema.index({ resource: 1, resourceId: 1 });
adminLogSchema.index({ action: 1, createdAt: -1 });
adminLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdminLog', adminLogSchema);
