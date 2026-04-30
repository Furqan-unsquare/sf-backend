const Event = require('../models/Event');
const Monument = require('../models/Monument');
const Booking = require('../models/Booking');
const SeatLayout = require('../models/SeatLayout');
const ShowSeatLayout = require('../models/ShowSeatLayout');
mongoose = require('mongoose');
const { generateShowSeatLayoutsForEvent } = require('../utils/showSeatLayoutGenerator');

// Helper function to convert YouTube watch URL to embed URL
const convertToEmbedUrl = (url) => {
  const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  return videoIdMatch ? `https://www.youtube.com/embed/${videoIdMatch[1]}` : url;
};

// Helper function to check if user is interested in event
const checkUserInterest = (event, userId) => {
  if (!userId || !event.interestedUsers) return false;
  return event.interestedUsers.some(id => id.toString() === userId.toString());
};

// Get all events with filters
exports.getAllEvents = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search,
      status,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { venue: { $regex: search, $options: 'i' } }
      ];
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (startDate || endDate) {
      query.$or = [
        {
          recurrence: 'daily',
          'dailySchedule.startDate': { $gte: new Date(startDate || '1900-01-01') },
          'dailySchedule.endDate': { $lte: new Date(endDate || '9999-12-31') }
        },
        {
          recurrence: 'specific',
          'specificSchedules.date': { $gte: new Date(startDate || '1900-01-01'), $lte: new Date(endDate || '9999-12-31') }
        }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const events = await Event.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Add userInterested flag for each event
    const eventsWithInterest = events.map(event => ({
      ...event,
      userInterested: req.user ? checkUserInterest(event, req.user) : false
    }));

    const totalCount = await Event.countDocuments(query);
    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        events: eventsWithInterest,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          limit: parseInt(limit),
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch events',
      error: error.message
    });
  }
};

// Get event by ID
exports.getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).lean();

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Add userInterested flag
    const eventWithInterest = {
      ...event,
      userInterested: req.user ? checkUserInterest(event, req.user) : false
    };

    res.json({
      success: true,
      data: eventWithInterest
    });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch event',
      error: error.message
    });
  }
};

// Create new event
exports.createEvent = async (req, res) => {
  try {
    console.log('Create Event Request Body:', JSON.stringify(req.body, null, 2));

    const existingImages = req.body.existingImages ? JSON.parse(req.body.existingImages) : [];
    const newImages = req.files ? req.files.map(file => file.path) : [];
    const images = [...existingImages, ...newImages];
    const thumbnail = images.length > 0 ? images[0] : null;
    const videos = req.body.videos ? JSON.parse(req.body.videos).map(convertToEmbedUrl) : [];

    const eventData = {
      name: req.body.name,
      images,
      thumbnail,
      videos,
      description: req.body.description,
      recurrence: req.body.recurrence,
      dailySchedule: req.body.recurrence === 'daily' ? JSON.parse(req.body.dailySchedule) : undefined,
      specificSchedules: req.body.recurrence === 'specific' ? JSON.parse(req.body.specificSchedules) : undefined,
      duration: parseFloat(req.body.duration),
      ageLimit: req.body.ageLimit,
      instructions: req.body.instructions ? JSON.parse(req.body.instructions) : [],
      status: req.body.status || 'draft',
      type: req.body.type,
      configureSeats: req.body.type === 'configure' ? (req.body.configureSeats === 'true' || req.body.configureSeats === true) : undefined,
      venue: req.body.venue,
      childDiscountPercentage: req.body.childDiscountPercentage ? parseFloat(req.body.childDiscountPercentage) : 0,
      foreignerIncreasePercentage: req.body.foreignerIncreasePercentage ? parseFloat(req.body.foreignerIncreasePercentage) : 0,
      isSpecial: req.body.isSpecial === 'true',
      isInterested: 0,
      interestedUsers: [] // Initialize empty array
    };

    const capacity = parseInt(req.body.capacity);
    console.log('Parsed capacity:', capacity); // DEBUG
    if (!isNaN(capacity)) eventData.capacity = capacity;

    const price = parseFloat(req.body.price);
    if (!isNaN(price)) eventData.price = price;

    const event = await Event.create(eventData);

    // Update the monument by appending the event ID
    const monument = await Monument.findOne({ name: eventData.venue });
    if (monument) {
      monument.events.push(event._id);
      await monument.save();
    }

    res.status(201).json({
      success: true,
      message: 'Event created successfully',
      data: event
    });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to create event',
      error: error.message
    });
  }
};

// Update event
exports.updateEvent = async (req, res) => {
  try {
    console.log('Update Event Request Body:', JSON.stringify(req.body, null, 2));

    // Fetch the old event to check for venue changes
    const oldEvent = await Event.findById(req.params.id);
    if (!oldEvent) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }
    const oldVenue = oldEvent.venue;

    const existingImages = req.body.existingImages ? JSON.parse(req.body.existingImages) : [];
    const newImages = req.files ? req.files.map(file => file.path) : [];
    const images = [...existingImages, ...newImages];
    const thumbnail = images.length > 0 ? images[0] : null;
    const videos = req.body.videos ? JSON.parse(req.body.videos).map(convertToEmbedUrl) : undefined;

    const eventData = {
      name: req.body.name,
      description: req.body.description,
      recurrence: req.body.recurrence,
      dailySchedule: req.body.recurrence === 'daily' ? JSON.parse(req.body.dailySchedule) : undefined,
      specificSchedules: req.body.recurrence === 'specific' ? JSON.parse(req.body.specificSchedules) : undefined,
      duration: parseFloat(req.body.duration),
      ageLimit: req.body.ageLimit,
      instructions: req.body.instructions ? JSON.parse(req.body.instructions) : [],
      status: req.body.status || 'draft',
      type: req.body.type,
      configureSeats: req.body.type === 'configure' ? (req.body.configureSeats === 'true' || req.body.configureSeats === true) : undefined,
      venue: req.body.venue,
      childDiscountPercentage: req.body.childDiscountPercentage ? parseFloat(req.body.childDiscountPercentage) : 0,
      foreignerIncreasePercentage: req.body.foreignerIncreasePercentage ? parseFloat(req.body.foreignerIncreasePercentage) : 0,
      isSpecial: req.body.isSpecial === 'true'
    };

    if (images.length > 0) {
      eventData.images = images;
      eventData.thumbnail = thumbnail;
    }
    if (videos) eventData.videos = videos;

    const capacity = parseInt(req.body.capacity);
    if (!isNaN(capacity)) eventData.capacity = capacity;

    const price = parseFloat(req.body.price);
    if (!isNaN(price)) eventData.price = price;

    const event = await Event.findByIdAndUpdate(
      req.params.id,
      eventData,
      { new: true, runValidators: true }
    );

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Handle monument update if venue changed
    if (event.venue !== oldVenue) {
      // Remove from old monument
      const oldMonument = await Monument.findOne({ name: oldVenue });
      if (oldMonument) {
        oldMonument.events.pull(event._id);
        await oldMonument.save();
      }

      // Add to new monument
      const newMonument = await Monument.findOne({ name: event.venue });
      if (newMonument) {
        newMonument.events.push(event._id);
        await newMonument.save();
      }
    }

    // Auto-generate ShowSeatLayouts if event is configure type and seat layout is published
    if (event.type === 'configure' || event.configureSeats === true) {
      try {
        const result = await generateShowSeatLayoutsForEvent(event._id);
        if (result.success) {
          console.log(`✅ Auto-generated ${result.count} ShowSeatLayouts for event ${event._id}`);
        } else {
          console.log(`ℹ️ ShowSeatLayout auto-generation skipped: ${result.message}`);
        }
      } catch (genError) {
        console.error('⚠️ Failed to auto-generate ShowSeatLayouts:', genError);
        // Don't fail the update - just log the error
      }
    }

    res.json({
      success: true,
      message: 'Event updated successfully',
      data: event
    });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to update event',
      error: error.message
    });
  }
};

// Delete event
exports.deleteEvent = async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Remove the event ID from the monument
    const monument = await Monument.findOne({ name: event.venue });
    if (monument) {
      monument.events.pull(event._id);
      await monument.save();
    }

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete event',
      error: error.message
    });
  }
};

// Toggle event status
exports.toggleEventStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!['draft', 'published', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const event = await Event.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    res.json({
      success: true,
      message: `Event ${status} successfully`,
      data: event
    });
  } catch (error) {
    console.error('Toggle event status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update event status',
      error: error.message
    });
  }
};

// Get event categories
exports.getEventCategories = async (req, res) => {
  try {
    const categories = ['cultural', 'educational', 'entertainment', 'sports', 'other'];

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories',
      error: error.message
    });
  }
};

// Toggle interest
exports.toggleInterest = async (req, res) => {
  try {
    const eventId = req.params.id;

    console.log('Toggle interest - req.user:', req.user); // DEBUG

    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login to mark interest.'
      });
    }

    // Get user ID - try both _id and id
    const userId = req.user._id || req.user.id;

    console.log('User ID:', userId); // DEBUG

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid user data. Please login again.'
      });
    }

    const event = await Event.findById(eventId);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Initialize interestedUsers array if it doesn't exist
    if (!event.interestedUsers) {
      event.interestedUsers = [];
    }

    console.log('Current interested users:', event.interestedUsers); // DEBUG

    // Check if user already interested
    const userIndex = event.interestedUsers.findIndex(
      id => id.toString() === userId.toString()
    );

    console.log('User index in interested list:', userIndex); // DEBUG

    if (userIndex > -1) {
      // User already interested - remove interest
      event.interestedUsers.splice(userIndex, 1);
      event.isInterested = Math.max(0, event.isInterested - 1);

      await event.save();

      return res.json({
        success: true,
        message: 'Interest removed successfully',
        data: {
          isInterested: event.isInterested,
          userInterested: false
        }
      });
    } else {
      // Add interest
      event.interestedUsers.push(userId);
      event.isInterested = (event.isInterested || 0) + 1;

      await event.save();

      return res.json({
        success: true,
        message: 'Interest added successfully',
        data: {
          isInterested: event.isInterested,
          userInterested: true
        }
      });
    }
  } catch (error) {
    console.error('Toggle interest error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle interest',
      error: error.message
    });
  }
};

// Get remaining capacity for an event on a specific date/time/language
exports.getRemainingCapacity = async (req, res) => {
  try {
    const { id: eventId } = req.params;
    const { date, time, language = '' } = req.query;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      return res.status(400).json({ success: false, message: 'Invalid event ID' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const queryDate = new Date(date);
    if (isNaN(queryDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date format' });
    }

    // Validate schedule first (common for both types)
    const isValidSchedule = validateEventSchedule(event, queryDate, time, language);
    if (!isValidSchedule.valid) {
      return res.status(400).json({
        success: false,
        message: isValidSchedule.message || 'No event scheduled for this date, time, or language'
      });
    }

    let remaining;

    // ✅ Check event type: walking (overall capacity) vs configure (seat-based)
    const isWalkingEvent = event.type === 'walking' || event.configureSeats === false;
    const isConfigureEvent = event.type === 'configure' || event.configureSeats === true;

    console.log(`[RemainingCapacity] Event: ${event.name} (${event._id}), Type: ${event.type}, Recurrence: ${event.recurrence}`);
    console.log(`[RemainingCapacity] Query: Date=${date}, Time=${time}, Lang=${language}`);

    if (isWalkingEvent) {
      // ✅ Walking: Sum tickets from bookings against overall capacity
      const query = {
        event: eventId,
        date: queryDate,
        time,
        ...(language && { language }),
        $or: [
          { status: { $in: ['confirmed', 'active'] } },
          { status: 'pending', expiresAt: { $gt: new Date() } }
        ]
      };

      const bookings = await Booking.find(query);
      let bookedCount = 0;
      bookings.forEach(b => {
        bookedCount += (b.adults || 0) + (b.children || 0);
      });

      const totalCapacity = (typeof event.capacity === 'number' && !isNaN(event.capacity)) ? event.capacity : 0;
      remaining = totalCapacity - bookedCount;

      console.log(`[RemainingCapacity] Walking Calculation: Capacity=${totalCapacity}, Booked=${bookedCount}, Remaining=${remaining}`);
    } else if (isConfigureEvent) {
      // Configure: Fetch from ShowSeatLayout (show-specific) and count available seats
      console.log(' Looking for ShowSeatLayout:', {
        event_id: eventId,
        date: queryDate.toISOString(),
        time,
        language: language || '(empty)'
      });

      const seatLayout = await ShowSeatLayout.findOne({
        event_id: eventId,
        date: queryDate,
        time,
        language: language || ''
      });

      if (!seatLayout) {
        console.error(' ShowSeatLayout not found');
        return res.status(404).json({
          success: false,
          message: 'Seat layout not found for this slot. Please create the seat layout for this show first.'
        });
      }

      console.log(` Found ShowSeatLayout with ${seatLayout.layout_data.length} seats`);

      // Release expired locks (>5 minutes)
      await seatLayout.releaseExpired();

      // Reload to get updated data
      const updatedLayout = await ShowSeatLayout.findById(seatLayout._id);

      // Count available seats
      const availableSeats = updatedLayout.layout_data.filter(seat => seat.status === 'available').length;
      remaining = availableSeats;

      console.log(` Configure capacity:`, {
        totalSeats: updatedLayout.layout_data.length,
        availableSeats,
        bookedSeats: updatedLayout.layout_data.filter(s => s.status === 'booked').length,
        lockedSeats: updatedLayout.layout_data.filter(s => s.status === 'locked').length
      });
    } else {
      return res.status(400).json({ success: false, message: 'Unsupported event type' });
    }

    res.json({ success: true, data: { remaining: Math.max(0, remaining) } });
  } catch (error) {
    console.error('Remaining capacity error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Helper function to validate event schedule (add this outside the main function)
function validateEventSchedule(event, queryDate, time, language) {
  // Normalize query date to YYYY-MM-DD for comparison
  const queryDateStr = queryDate.toISOString().split('T')[0];

  // Check if date is in specificSchedules
  let specificSchedule = null;
  if (event.recurrence === 'specific' && event.specificSchedules) {
    specificSchedule = event.specificSchedules.find(s => {
      if (!s.date) return false;
      const specDateStr = new Date(s.date).toISOString().split('T')[0];
      return specDateStr === queryDateStr;
    });
  }

  let timeSlots;
  if (specificSchedule) {
    timeSlots = specificSchedule.timeSlots;
  } else {
    // For daily schedule, check date range first
    // Only parse start/end dates if we are checking daily schedule logic
    const dailySchedule = event.dailySchedule || {};
    if (!dailySchedule.startDate || !dailySchedule.endDate) {
      // If logic falls here but no daily schedule exists (e.g. strict specific event with no match), it's invalid
      return { valid: false, message: 'No event scheduled on this date' };
    }

    const startDate = new Date(dailySchedule.startDate);
    const endDate = new Date(dailySchedule.endDate);

    // Check for invalid dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return { valid: false, message: 'Invalid event schedule dates' };
    }

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];

    if (queryDateStr < startDateStr || queryDateStr > endDateStr) {
      console.log(`[Validation] Date out of range: ${queryDateStr} vs ${startDateStr}-${endDateStr}`);
      return { valid: false, message: 'No event scheduled on this date' };
    }
    timeSlots = dailySchedule.timeSlots || [];
  }

  // Check if time exists in timeSlots
  // Normalize time to ensure HH:MM format matching (e.g. "8:00" matches "08:00")
  const normalizeTime = (t) => t ? t.replace(/^(\d):/, '0$1:') : '';
  const normalizedQueryTime = normalizeTime(time);

  const matchingTimeSlot = timeSlots.find(ts => normalizeTime(ts.time) === normalizedQueryTime);

  if (!matchingTimeSlot) {
    console.log(`[Validation] Time not found. Query: ${normalizedQueryTime}, Available: ${timeSlots.map(t => t.time).join(', ')}`);
    return { valid: false, message: 'No event scheduled at this time' };
  }

  // Check language
  if (language && language !== 'none' && language !== '') {
    if (!matchingTimeSlot.isLangAvailable && matchingTimeSlot.lang !== language) {
      console.log(`[Validation] Language mismatch. Slot: ${matchingTimeSlot.lang} (fixed), Query: ${language}`);
      // NOTE: If the slot is NOT language available, it defaults to its set language (usually 'en').
      // If query requests 'hi', but slot is fixed 'en', it should probably fail.
      return { valid: false, message: 'No event scheduled in this language' };
    }
  }

  return { valid: true };
}