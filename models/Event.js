const mongoose = require('mongoose');

const timeSlotSchema = new mongoose.Schema({
  time: {
    type: String,
    required: true,
    match: /^([01]\d|2[0-3]):([0-5]\d)$/ 
  },
  isLangAvailable: {
    type: Boolean,
    default: false
  },
  lang: {
    type: String,
    enum: ['en', 'hi'],
    required: function() { return this.isLangAvailable; }
  }
});

const dailyScheduleSchema = new mongoose.Schema({
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  timeSlots: [timeSlotSchema]
});

const specificScheduleSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true
  },
  timeSlots: [timeSlotSchema]
});

const eventSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Event name is required'],
    trim: true,
    maxlength: [200, 'Name cannot exceed 200 characters']
  },
  images: {
    type: [String],
    default: []
  },
  thumbnail: {
    type: String,
    default: null
  },
  videos: {
    type: [String],
    default: []
  },
  description: {
    type: String,
    required: [true, 'Event description is required'],
    maxlength: [2000, 'Description cannot exceed 1000 characters']
  },
  recurrence: {
    type: String,
    enum: ['specific', 'daily'],
    default: 'specific'
  },
  dailySchedule: {
    type: dailyScheduleSchema,
    required: function() { return this.recurrence === 'daily'; }
  },
  specificSchedules: {
    type: [specificScheduleSchema],
    required: function() { return this.recurrence === 'specific'; }
  },
  duration: {
    type: Number,
    required: [true, 'Duration is required'],
    min: [0.5, 'Duration must be at least 0.5 hours']
  },
  ageLimit: {
    type: String,
    required: [true, 'Age limit is required'],
    enum: ['all', '5+', '12+', '18+', '21+']
  },
  instructions: {
    type: [String],
    trim: true,
    maxlength: [1000, 'Instructions cannot exceed 1000 characters per item']
  },
  status: { 
    type: String,
    enum: ['draft', 'published', 'inactive'],
    default: 'draft'
  },
  type: {
    type: String,
    enum: ['walking', 'configure'],
    required: [true, 'Event type is required']
  },
  capacity: {
    type: Number,
    min: [1, 'Capacity must be at least 1'],
    required: false
  },
  price: {
    type: Number,
    min: [0, 'Price cannot be negative'],
    required: false
  },
  configureSeats: {
    type: Boolean,
    default: false,
    required: [
      function() { return this.type === 'configure'; },
      'Configure seats is required for configured events'
    ]
  },
  venue: {
    type: String,
    required: [true, 'Venue is required']
  },
  childDiscountPercentage: {
    type: Number,
    min: [0, 'Discount percentage cannot be negative'],
    max: [100, 'Discount percentage cannot exceed 100'],
    default: 0
  },
  foreignerIncreasePercentage: {
    type: Number,
    min: [0, 'Increase percentage cannot be negative'],
    default: 0
  },
  isSpecial: {
    type: Boolean,
    default: false
  },
  isInterested: {
    type: Number,
    default: 0,
    min: 0
  },
  // NEW: Track which users are interested
  interestedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: []
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

// Indexes for performance
eventSchema.index({ status: 1 });
eventSchema.index({ name: 'text', description: 'text' });
eventSchema.index({ interestedUsers: 1 }); // NEW: Index for interested users

eventSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  if (this.images && this.images.length > 0 && !this.thumbnail) {
    this.thumbnail = this.images[0];
  }
  next();
});

module.exports = mongoose.model('Event', eventSchema);
