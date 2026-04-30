const Monument = require('../models/Monument');

// Get all monuments
exports.getAllMonuments = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      category,
      state,
      city,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { establishmentEra: { $regex: search, $options: 'i' } },
        { style: { $regex: search, $options: 'i' } }
      ];
    }

    if (category) query.category = category;
    if (state) query['location.state'] = state;
    if (city) query['location.city'] = city;
    if (status) query.status = status;

    // if(req?.user && req.user.role !== 'admin') {
    //   query.status = 'active';
    // }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const [monuments, totalCount] = await Promise.all([
      Monument.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Monument.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      data: {
        monuments,
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
    console.error('Get monuments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch monuments',
      error: error.message
    });
  }
};

// Get monument by ID with populated events
exports.getMonumentById = async (req, res) => {
  try {
    const monument = await Monument.findById(req.params.id)
      .populate('events') // Populate the events field
      .lean();

    if (!monument) {
      return res.status(404).json({
        success: false,
        message: 'Monument not found'
      });
    }

    res.json({
      success: true,
      data: monument
    });
  } catch (error) {
    console.error('Get monument error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch monument',
      error: error.message
    });
  }
};

// Create new monument
exports.createMonument = async (req, res) => {
  try {
    const monumentData = { ...req.body };

    const monument = await Monument.create(monumentData);

    const populatedMonument = await Monument.findById(monument._id).lean();

    res.status(201).json({
      success: true,
      message: 'Monument created successfully',
      data: populatedMonument
    });
  } catch (error) {
    console.error('Create monument error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create monument',
      error: error.message
    });
  }
};

// Update monument
exports.updateMonument = async (req, res) => {
  try {
    const monument = await Monument.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!monument) {
      return res.status(404).json({
        success: false,
        message: 'Monument not found'
      });
    }

    res.json({
      success: true,
      message: 'Monument updated successfully',
      data: monument
    });
  } catch (error) {
    console.error('Update monument error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update monument',
      error: error.message
    });
  }
};

// Delete monument
exports.deleteMonument = async (req, res) => {
  try {
    const monument = await Monument.findByIdAndDelete(req.params.id);

    if (!monument) {
      return res.status(404).json({
        success: false,
        message: 'Monument not found'
      });
    }

    res.json({
      success: true,
      message: 'Monument deleted successfully'
    });
  } catch (error) {
    console.error('Delete monument error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete monument',
      error: error.message
    });
  }
};

// Get monument categories, locations, and other filters
exports.getMonumentFilters = async (req, res) => {
  try {
    const [categories, states, cities, statuses, styles, eras] = await Promise.all([
      Monument.distinct('category'),
      Monument.distinct('location.state'),
      Monument.distinct('location.city'),
      Monument.distinct('status'),
      Monument.distinct('style'),
      Monument.distinct('establishmentEra')
    ]);

    res.json({
      success: true,
      data: {
        categories,
        states,
        cities,
        statuses,
        styles,
        eras
      }
    });
  } catch (error) {
    console.error('Get monument filters error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch monument filters',
      error: error.message
    });
  }
};

// New endpoint: Get events for a specific monument
exports.getEventsForMonument = async (req, res) => {
  try {
    const monument = await Monument.findById(req.params.id)
      .populate('events') // Populate all events first
      .select('events')
      .lean();

    if (!monument) {
      return res.status(404).json({
        success: false,
        message: 'Monument not found'
      });
    }

    let events = monument.events || [];

    // If user is not admin, filter out unpublished events
    if (req?.user?.role !== 'admin') {
      events = events.filter(event => event.status === 'published');
    }
    // console.log('Filtered events:', events);
    res.json({
      success: true,
      data: events
    });
  } catch (error) {
    console.error('Get events for monument error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch events for monument',
      error: error.message
    });
  }
};
