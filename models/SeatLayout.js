const mongoose = require('mongoose');

const seatDataSchema = new mongoose.Schema({
  seatId: {
    type: String,
    required: true
  },
  row: {
    type: String,
    required: true
  },
  number: {
    type: Number,
    required: true
  },
  section: {
    type: String,
    required: true,
    default: 'Main'
  },
  category: {
    type: String,
    enum: ['VIP','Premium', 'Gold', 'Silver', 'Bronze'],
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['available', 'booked', 'locked', 'blocked'],
    default: 'available'
  },
  lockedBy: {
    type: String
  },
  lockedAt: {
    type: Date
  },
  coords: {
    x: { type: Number, required: true },
    y: { type: Number, required: true }
  }
}, { _id: false });

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    enum: ['VIP', 'Premium', 'Gold', 'Silver', 'Bronze']
  },
  color: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  }
}, { _id: false });

const defaultCategories = [
  { name: 'VIP', color: '#ecab63', price: 200 },
  { name: 'Premium', color: '#00b5f8', price: 150 },
  { name: 'Gold', color: '#7b2d96', price: 130 },
  { name: 'Silver', color: '#f11e8e', price: 120 },
  { name: 'Bronze', color: '#76e8fa', price: 90 }
];

const seatLayoutSchema = new mongoose.Schema({
  event_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true,
    unique: true
  },
  layout_data: [seatDataSchema],
  categories: {
    type: [categorySchema],
    default: defaultCategories
  },
  total_seats: {
    type: Number,
    default: 0
  },
  available_seats: {
    type: Number,
    default: 0
  },
  booked_seats: {
    type: Number,
    default: 0
  },
  layout_name: {
    type: String,
    default: 'Default Layout'
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  is_published: {
    type: Boolean,
    default: false
  },
  stage: {
    x: { type: Number },
    y: { type: Number },
    width: { type: Number },
    height: { type: Number },
    label: { type: String }
  }
}, {
  timestamps: true
});

// Index for better query performance
seatLayoutSchema.index({ event_id: 1 });

// Pre-save middleware to update seat counts and ensure category price consistency
seatLayoutSchema.pre('save', function(next) {
  console.log('Pre-save hook: categories before processing:', this.categories);
  this.total_seats = this.layout_data?.length;
  this.available_seats = this.layout_data?.filter(seat => seat.status === 'available').length;
  this.booked_seats = this.layout_data?.filter(seat => seat.status === 'booked').length;

  // Ensure categories is not empty
  if (!this.categories || this.categories.length === 0) {
    console.log('Pre-save hook: categories is empty, setting default categories');
    this.categories = defaultCategories;
  }

  // Ensure seat prices match category prices
  this.layout_data = this.layout_data?.map(seat => {
    const category = this.categories.find(cat => cat.name === seat.category);
    return category ? { ...seat, price: category.price } : seat;
  });

  console.log('Pre-save hook: categories after processing:', this.categories);
  next();
});

// Pre-update middleware to prevent categories from being set to empty
seatLayoutSchema.pre(['updateOne', 'findOneAndUpdate'], function(next) {
  const update = this.getUpdate();
  console.log('Pre-update hook: update object:', update);
  if (update.$set && (update.$set.categories === null || update.$set.categories?.length === 0)) {
    console.log('Pre-update hook: preventing empty categories, setting default');
    update.$set.categories = defaultCategories;
  }
  next();
});

// Method to get seats by category
seatLayoutSchema.methods.getSeatsByCategory = function(category) {
  return this.layout_data.filter(seat => seat.category === category);
};

// Method to get available seats by category
seatLayoutSchema.methods.getAvailableSeatsByCategory = function(category) {
  return this.layout_data.filter(seat => 
    seat.category === category && seat.status === 'available'
  );
};

// Method to update category price
seatLayoutSchema.methods.updateCategoryPrice = async function(categoryName, price) {
  console.log('updateCategoryPrice: categories before update:', this.categories);
  console.log('updateCategoryPrice: attempting to update category:', categoryName, 'with price:', price);

  if (!this.categories || this.categories.length === 0) {
    console.error('updateCategoryPrice: categories array is empty, initializing with defaults');
    this.categories = defaultCategories;
    await this.save();
  }

  if (!this.categories.some(cat => cat.name === categoryName)) {
    console.error(`updateCategoryPrice: Category ${categoryName} not found in categories:`, this.categories);
    throw new Error(`Category ${categoryName} not found`);
  }

  if (price < 0) {
    console.error('updateCategoryPrice: Invalid price:', price);
    throw new Error('Price cannot be negative');
  }

  const updated = await this.constructor.findOneAndUpdate(
    { _id: this._id },
    {
      $set: {
        'categories.$[cat].price': price,
        'layout_data.$[seat].price': price
      }
    },
    {
      arrayFilters: [
        { 'cat.name': categoryName },
        { 'seat.category': categoryName }
      ],
      new: true
    }
  );

  if (!updated) {
    console.error('updateCategoryPrice: Failed to update category price for', categoryName);
    throw new Error('Failed to update category price');
  }

  console.log('updateCategoryPrice: Updated seat layout:', updated);
  return updated;
};

// Method to book seats
seatLayoutSchema.methods.bookSeats = async function(seatIds, lockedBy = null, lockTimeoutMinutes = 5) {
  const timeoutMs = lockTimeoutMinutes * 60 * 1000;
  const now = new Date();
  const expiryDate = new Date(Date.now() - timeoutMs);

  const conflict = await this.constructor.findOne({
    _id: this._id,
    layout_data: {
      $elemMatch: {
        seatId: { $in: seatIds },
        $or: [
          { status: 'booked' },
          { status: 'locked', lockedBy: { $ne: lockedBy }, lockedAt: { $gt: expiryDate } }
        ]
      }
    }
  });

  if (conflict) {
    const latest = await this.constructor.findById(this._id).lean();
    const conflicted = latest.layout_data
      .filter(s => seatIds.includes(s.seatId) && (s.status === 'booked' || (s.status === 'locked' && s.lockedBy !== lockedBy && new Date(s.lockedAt) > expiryDate)))
      .map(s => s.seatId);
    return { success: false, conflicted };
  }

  const updated = await this.constructor.findOneAndUpdate(
    { _id: this._id },
    {
      $set: {
        'layout_data.$[elem].status': 'booked',
        'layout_data.$[elem].lockedBy': null,
        'layout_data.$[elem].lockedAt': null
      }
    },
    {
      arrayFilters: [{ 'elem.seatId': { $in: seatIds } }],
      new: true
    }
  ).lean();

  if (updated) {
    await this.constructor.updateOne({ _id: this._id }, {
      $set: {
        total_seats: updated.layout_data.length,
        available_seats: updated.layout_data.filter(s => s.status === 'available').length,
        booked_seats: updated.layout_data.filter(s => s.status === 'booked').length
      }
    });
    return { success: true, seatLayout: updated };
  }

  return { success: false, message: 'Failed to book seats' };
};

// Method to release seats
seatLayoutSchema.methods.releaseSeats = async function(seatIds) {
  const updated = await this.constructor.findOneAndUpdate(
    { _id: this._id },
    {
      $set: {
        'layout_data.$[elem].status': 'available'
      },
      $unset: {
        'layout_data.$[elem].lockedBy': '',
        'layout_data.$[elem].lockedAt': ''
      }
    },
    {
      arrayFilters: [{ 'elem.seatId': { $in: seatIds }, $or: [ { 'elem.status': 'booked' }, { 'elem.status': 'locked' } ] }],
      new: true
    }
  ).lean();

  if (updated) {
    await this.constructor.updateOne({ _id: this._id }, {
      $set: {
        total_seats: updated.layout_data.length,
        available_seats: updated.layout_data.filter(s => s.status === 'available').length,
        booked_seats: updated.layout_data.filter(s => s.status === 'booked').length
      }
    });
  }

  return { success: true, seatLayout: updated };
};

// Method to lock seats temporarily
seatLayoutSchema.methods.lockSeats = async function(seatIds, lockedBy, lockTimeoutMinutes = 5) {
  const timeoutMs = lockTimeoutMinutes * 60 * 1000;
  const expiryDate = new Date(Date.now() - timeoutMs);

  const conflict = await this.constructor.findOne({
    _id: this._id,
    layout_data: {
      $elemMatch: {
        seatId: { $in: seatIds },
        $or: [
          { status: 'booked' },
          { status: 'locked', lockedBy: { $ne: lockedBy }, lockedAt: { $gt: expiryDate } }
        ]
      }
    }
  });
 
  if (conflict) {
    const latest = await this.constructor.findById(this._id).lean();
    const conflicted = latest.layout_data
      .filter(s => seatIds.includes(s.seatId) && (s.status === 'booked' || (s.status === 'locked' && s.lockedBy !== lockedBy && new Date(s.lockedAt) > expiryDate)))
      .map(s => s.seatId);
    return { success: false, conflicted };
  }

  const now = new Date();
  const updated = await this.constructor.findOneAndUpdate(
    { _id: this._id },
    {
      $set: {
        'layout_data.$[elem].status': 'locked',
        'layout_data.$[elem].lockedBy': lockedBy,
        'layout_data.$[elem].lockedAt': now
      }
    },
    {
      arrayFilters: [{ 'elem.seatId': { $in: seatIds } }],
      new: true
    }
  ).lean();

  if (updated) {
    await this.constructor.updateOne({ _id: this._id }, {
      $set: {
        total_seats: updated.layout_data.length,
        available_seats: updated.layout_data.filter(s => s.status === 'available').length,
        booked_seats: updated.layout_data.filter(s => s.status === 'booked').length
      }
    });
    return { success: true, seatLayout: updated };
  }

  return { success: false, message: 'Failed to lock seats' };
};

// Method to unlock seats
seatLayoutSchema.methods.unlockSeats = async function(seatIds, lockedBy, lockTimeoutMinutes = 5) {
  const timeoutMs = lockTimeoutMinutes * 60 * 1000;
  const expiryDate = new Date(Date.now() - timeoutMs);

  const updated = await this.constructor.findOneAndUpdate(
    { _id: this._id },
    {
      $set: {
        'layout_data.$[elem].status': 'available'
      },
      $unset: {
        'layout_data.$[elem].lockedBy': '',
        'layout_data.$[elem].lockedAt': ''
      }
    },
    {
      arrayFilters: [
        {
          'elem.seatId': { $in: seatIds },
          $or: [ { 'elem.lockedBy': lockedBy }, { 'elem.lockedAt': { $lte: expiryDate } } ]
        }
      ],
      new: true
    }
  ).lean();

  if (updated) {
    await this.constructor.updateOne({ _id: this._id }, {
      $set: {
        total_seats: updated.layout_data.length,
        available_seats: updated.layout_data.filter(s => s.status === 'available').length,
        booked_seats: updated.layout_data.filter(s => s.status === 'booked').length
      }
    });
    return { success: true, seatLayout: updated };
  }

  return { success: false, message: 'Failed to unlock seats' };
};

// Method to release expired locks
seatLayoutSchema.methods.releaseExpired = async function(lockTimeoutMinutes = 5) {
  const timeoutMs = lockTimeoutMinutes * 60 * 1000;
  const expiryDate = new Date(Date.now() - timeoutMs);

  const updated = await this.constructor.findOneAndUpdate(
    { _id: this._id },
    {
      $set: { 'layout_data.$[elem].status': 'available' },
      $unset: { 'layout_data.$[elem].lockedBy': '', 'layout_data.$[elem].lockedAt': '', 'layout_data.$[elem].lockType': '' }
    },
    {
      arrayFilters: [{ 'elem.status': 'locked', 'elem.lockedAt': { $lte: expiryDate } }],
      new: true
    }
  ).lean();

  if (updated) {
    await this.constructor.updateOne({ _id: this._id }, {
      $set: {
        total_seats: updated.layout_data.length,
        available_seats: updated.layout_data.filter(s => s.status === 'available').length,
        booked_seats: updated.layout_data.filter(s => s.status === 'booked').length
      }
    });
  }

  return { success: true, seatLayout: updated };
};

// Method to publish the layout
seatLayoutSchema.methods.publish = function() {
  this.is_published = true;
  return this.save();
};

module.exports = mongoose.model('SeatLayout', seatLayoutSchema);