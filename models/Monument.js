const mongoose = require('mongoose');

const monumentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Monument name is required'],
    trim: true,
    maxlength: [200, 'Name cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  category: {
    type: String,
    required: true,
    enum: ['historical', 'religious', 'architectural', 'natural', 'cultural', 'other']
  },
  image: {
    base64: { type: String }, // Single base64 string
  },
  status: {
    type: String,
    required: true,
    enum: ['active', 'inactive', 'pending'],
    default: 'active'
  },
  establishmentEra: {
    type: String,
    trim: true,
    maxlength: [100, 'Establishment era cannot exceed 100 characters']
  },
  style: {
    type: String,
    trim: true,
    maxlength: [100, 'Style cannot exceed 100 characters']
  },
  location: {
    state: {
      type: String,
      trim: true
    },
    city: {
      type: String,
      trim: true
    }
  },
  tags: [String],
  events: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
monumentSchema.index({ name: 'text', description: 'text' });
monumentSchema.index({ category: 1 });
monumentSchema.index({ status: 1 });
monumentSchema.index({ 'location.state': 1 });
monumentSchema.index({ 'location.city': 1 });

monumentSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Monument', monumentSchema);