const mongoose = require('mongoose');
const SeatLayout = require('../models/SeatLayout');
const ShowSeatLayout = require('../models/ShowSeatLayout');
const Event = require('../models/Event');
const Booking = require('../models/Booking');
const { resolvePricing, resolveSeatPrice } = require('../utils/pricingRules');

// Create seat layout for event (admin only)
exports.createSeatLayout = async (req, res) => {
  try {
    const { event_id, layout_data, layout_name } = req.body;

    // Check if event exists
    const event = await Event.findById(event_id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Check if event is configured for seating
    const isSeated = (event.capacity_type && event.capacity_type === 'seated') || event.configureSeats === true || event.type === 'configure';
    if (!isSeated) {
      return res.status(400).json({
        success: false,
        message: 'Seat layout can only be created for configured/seated events'
      });
    }

    // Check if layout already exists
    const existingLayout = await SeatLayout.findOne({ event_id });
    if (existingLayout) {
      return res.status(400).json({
        success: false,
        message: 'Seat layout already exists for this event',
        data: { seatLayout: existingLayout }
      });
    }

    // Create seat layout
    const seatLayout = new SeatLayout({
      event_id,
      layout_data,
      layout_name: layout_name || 'Default Layout',
      stage: req.body.stage || undefined,
      created_by: req.user._id
    });

    await seatLayout.save();

    res.status(201).json({
      success: true,
      message: 'Seat layout created successfully',
      data: { seatLayout }
    });
  } catch (error) {
    console.error('Create seat layout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create seat layout',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get seat layout for event (public) — returns template if date/time not provided; otherwise returns show-scoped layout if admin has set it
exports.getSeatLayout = async (req, res) => {
  try {
    const { event_id } = req.params;
    const { date, time, language } = req.query;

    if (!date || !time) {
      // Return template layout for admin/editor usage
      const template = await SeatLayout.findOne({ event_id });
      if (!template) return res.status(404).json({ success: false, message: 'Seat layout template not found for this event' });
      return res.json({ success: true, data: { seatLayout: template } });
    }

    const showDate = new Date(date);

    // FETCH EVENT TO DETERMINE isSpecial AUTHORITATIVELY
    const event = await Event.findById(event_id);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    // --- DATE VALIDATION START ---
    // --- DETAILED SCHEDULE VALIDATION & AUTO-CREATION START ---
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);

    let isDateValid = false;
    let isTimeValid = false;
    let isLangValid = false;

    // Check Recurrence Rules
    if (event.recurrence === 'daily' && event.dailySchedule) {
      const start = new Date(event.dailySchedule.startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(event.dailySchedule.endDate);
      end.setHours(0, 0, 0, 0);

      if (checkDate >= start && checkDate <= end) {
        isDateValid = true;
        // Check Time & Language
        for (const slot of event.dailySchedule.timeSlots || []) {
          if (slot.time === time) {
            isTimeValid = true;
            if (!slot.isLangAvailable) {
              // Slot is language-agnostic; any lang parameter or empty is treated as valid contextually, 
              // but usually means 'none' or 'default'. 
              // If language param is provided but slot says not available, stricly speaking it's a mismatch 
              // UNLESS "language" param is empty string.
              // But legacy logic might be loose. Let's be strict if param is provided.
              if (!language) isLangValid = true;
              else isLangValid = false; // Mismatch? Or ignore? User said "validating date/time and lang"
            } else {
              // Slot requires language
              if (slot.lang === language) isLangValid = true;
            }
          }
          if (isTimeValid && isLangValid) break;
          // Reset for next slot check if this one failed lang
          if (isTimeValid && !isLangValid) isTimeValid = false;
        }
      }
    } else if (event.recurrence === 'specific' && event.specificSchedules) {
      const schedule = event.specificSchedules.find(s => {
        const sDate = new Date(s.date);
        sDate.setHours(0, 0, 0, 0);
        return sDate.getTime() === checkDate.getTime();
      });

      if (schedule) {
        isDateValid = true;
        for (const slot of schedule.timeSlots || []) {
          if (slot.time === time) {
            isTimeValid = true;
            if (!slot.isLangAvailable) {
              if (!language) isLangValid = true;
              else isLangValid = false;
            } else {
              if (slot.lang === language) isLangValid = true;
            }
          }
          if (isTimeValid && isLangValid) break;
          if (isTimeValid && !isLangValid) isTimeValid = false;
        }
      }
    }

    if (!isDateValid) {
      return res.status(400).json({ success: false, message: `Event is not scheduled on ${date}.` });
    }
    // Relaxed check: if time/lang check failed but date passed, maybe return vague error or specific?
    // User asked to validate them.
    // However, existing FE might send loose params. 
    // Let's rely on finding a valid slot. 
    // Note: The loop above is strict. If no slot matched both time & lang, valid is false.
    // Let's be robust: If strict validation fails, we can't auto-create because we don't know if it's authorized.
    if (!isTimeValid || !isLangValid) {
      // Re-check for strict fail. 
      // Logic: if we found the date, we MUST find a matching slot.
      return res.status(400).json({ success: false, message: `Event is not scheduled at ${time} with language '${language || 'none'}' on this date.` });
    }

    const isSpecialFlag = event.isSpecial === true;

    // 1. Try to find existing layout
    let showLayout = await ShowSeatLayout.findOne({ event_id, date: showDate, time, language: language || '' });

    // 2. If not found, AUTO-CREATE from template
    if (!showLayout) {
      console.log(`[getSeatLayout] Layout missing for valid slot ${date} ${time} (${language}). Auto-creating...`);

      const template = await SeatLayout.findOne({ event_id });
      if (!template) return res.status(404).json({ success: false, message: 'Seat layout template not found for this event' });

      try {
        // Clone template to new ShowSeatLayout
        const newShow = new ShowSeatLayout({
          event_id,
          date: showDate,
          time,
          language: language || '',
          // Copy seat data
          layout_data: template.layout_data || template.seats || [],
          stage: template.stage,
          total_seats: template.total_seats || (template.layout_data?.length || 0),
          available_seats: template.total_seats || (template.layout_data?.length || 0),
          booked_seats: 0
        });

        await newShow.save();
        showLayout = newShow;
        console.log(`[getSeatLayout] Auto-created new ShowSeatLayout: ${newShow._id}`);
      } catch (err) {
        // Handle Race Condition: Duplicate Key Error (E11000)
        if (err.code === 11000) {
          console.log(`[getSeatLayout] Simultaneous creation detected. Fetching existing layout.`);
          showLayout = await ShowSeatLayout.findOne({ event_id, date: showDate, time, language: language || '' });
          if (!showLayout) {
            return res.status(500).json({ success: false, message: 'Failed to retrieve seat layout (concurrency error)' });
          }
        } else {
          console.error('Auto-create show layout error:', err);
          return res.status(500).json({ success: false, message: 'Failed to generate seat layout' });
        }
      }
    }
    // --- DETAILED SCHEDULE VALIDATION & AUTO-CREATION END ---

    // Release expired locks before pricing resolution
    await showLayout.releaseExpired(5, 'user');

    const template = await SeatLayout.findOne({ event_id });
    if (!template) return res.status(404).json({ success: false, message: 'Seat layout template not found for this event' });

    // Build dynamic pricing matrix for this show (per row A–J)
    let pricingByRow = {};

    // Only apply dynamic pricing rules if it's a special event
    console.log(`[getSeatLayout] Checking dynamic pricing. isSpecialFlag=${isSpecialFlag}, date=${showDate.toISOString()}, time=${time}`);
    if (isSpecialFlag) {
      try {
        pricingByRow = resolvePricing({ date: showDate, time });
        console.log(`[getSeatLayout] Resolved pricing keys: ${Object.keys(pricingByRow)}`);
      } catch (e) {
        console.error('Pricing resolution error:', e);
        // For special events, pricing error is critical?
        // Or should we fallback? Let's return error to be safe as per user requirement for checking pricing
        return res.status(400).json({
          success: false,
          message: e.message || 'Invalid show time for pricing',
        });
      }
    }

    const result = showLayout.toObject();

    // Attach resolved price per seat (without persisting in DB)
    result.layout_data = (result.layout_data || []).map(seat => {
      const rowKey = seat.row;
      const resolvedPrice = pricingByRow[rowKey] != null
        ? pricingByRow[rowKey]
        : seat.price; // fallback to existing if row out-of-range or not special

      return {
        ...seat,
        price: resolvedPrice,
      };
    });

    // Derive category legend pricing from resolved seat prices
    const categoryPriceMap = {};
    for (const seat of result.layout_data) {
      if (!seat.category) continue;
      const price = seat.price; // Use the resolved price we just set
      if (price == null) continue;
      if (
        categoryPriceMap[seat.category] == null ||
        price < categoryPriceMap[seat.category] // Assuming we show 'starts from' or just one price. Logic was finding min price?
        // Original logic: price < categoryPriceMap (finding min price for category?)
        // Let's stick to original behavior but using resolved price
      ) {
        categoryPriceMap[seat.category] = price;
      }
    }

    result.categories = (template.categories || []).map(cat => {
      const plainCat = cat.toObject ? cat.toObject() : cat;
      return {
        ...plainCat,
        // use dynamically resolved category price if available
        price: categoryPriceMap[plainCat.name] != null
          ? categoryPriceMap[plainCat.name]
          : plainCat.price,
      };
    });

    res.json({ success: true, data: { seatLayout: result } });
  } catch (error) {
    console.error('Get seat layout error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch seat layout', error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
};

// Update seat layout for event (admin only)
exports.updateSeatLayout = async (req, res) => {
  try {
    const { event_id } = req.params;
    const { layout_data, layout_name } = req.body;

    const seatLayout = await SeatLayout.findOne({ event_id });

    if (!seatLayout) {
      return res.status(404).json({
        success: false,
        message: 'Seat layout not found for this event'
      });
    }

    // Update layout
    seatLayout.layout_data = layout_data;
    if (req.body.stage) seatLayout.stage = req.body.stage;
    if (layout_name) seatLayout.layout_name = layout_name;
    await seatLayout.save();

    // Propagate template changes into existing show-scoped layouts
    try {
      const templateSeats = seatLayout.layout_data || [];
      const showLayouts = await ShowSeatLayout.find({ event_id });

      for (const show of showLayouts) {
        // Build a map of existing seats by seatId for quick lookup
        const existingMap = new Map();
        (show.layout_data || []).forEach(s => existingMap.set(s.seatId, s));

        // Merge: for each template seat, if the corresponding show seat is booked/locked preserve the entire seat object,
        // otherwise copy the template seat properties and reset status to available
        const merged = templateSeats.map(ts => {
          const existing = existingMap.get(ts.seatId);
          if (existing && (existing.status === 'booked' || existing.status === 'locked')) {
            // Preserve booked/locked seat as-is (do not overwrite coords/category/price/status)
            return existing;
          }
          // Respect template's status (could be 'available', 'blocked', or if admin set 'locked')
          const statusFromTemplate = ts.status || 'available';
          const mergedSeat = {
            seatId: ts.seatId,
            row: ts.row,
            number: ts.number,
            section: ts.section,
            category: ts.category,
            price: ts.price,
            status: statusFromTemplate,
            lockedBy: statusFromTemplate === 'locked' ? (ts.lockedBy || null) : null,
            lockedAt: statusFromTemplate === 'locked' ? (ts.lockedAt || null) : null,
            coords: ts.coords
          };
          return mergedSeat;
        });

        // Include any existing booked/locked seats that no longer exist in the template
        const templateIds = new Set(templateSeats.map(s => s.seatId));
        for (const [id, existing] of existingMap.entries()) {
          if (!templateIds.has(id) && (existing.status === 'booked' || existing.status === 'locked')) {
            merged.push(existing);
          }
        }

        show.layout_data = merged;
        // Update stage on show layouts if template provided a stage (keep existing if not provided)
        if (req.body.stage) show.stage = req.body.stage;
        await show.save();
      }
    } catch (propErr) {
      console.error('Failed to propagate template updates to show layouts:', propErr);
      // Non-fatal: continue and return success for template update, but include a warning
      return res.json({
        success: true,
        message: 'Seat layout updated successfully (but failed to update some show layouts)',
        data: { seatLayout, warning: propErr.message }
      });
    }

    res.json({
      success: true,
      message: 'Seat layout updated successfully',
      data: { seatLayout }
    });
  } catch (error) {
    console.error('Update seat layout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update seat layout',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Delete seat layout for event (admin only)
exports.deleteSeatLayout = async (req, res) => {
  try {
    const { event_id } = req.params;

    const seatLayout = await SeatLayout.findOne({ event_id });

    if (!seatLayout) {
      return res.status(404).json({
        success: false,
        message: 'Seat layout not found for this event'
      });
    }

    // Check if there are any bookings for this event
    const bookingCount = await Booking.countDocuments({ event: event_id });
    if (bookingCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete seat layout with existing bookings'
      });
    }

    await SeatLayout.deleteOne({ event_id });

    res.json({
      success: true,
      message: 'Seat layout deleted successfully'
    });
  } catch (error) {
    console.error('Delete seat layout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete seat layout',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Lock specific seats (user-facing)
exports.lockSeatsUser = async (req, res) => {
  try {
    const { event_id } = req.params;
    let { seat_ids, session_id, date, time, language } = req.body;

    // if (!session_id) {
    //   return res.status(400).json({ success: false, message: 'Session ID is required' });
    // }

    if (!Array.isArray(seat_ids)) {
      seat_ids = [seat_ids];
    }

    if (seat_ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Seat IDs are required' });
    }

    if (!date || !time) {
      return res.status(400).json({ success: false, message: 'Date and time are required for locking seats' });
    }

    const showDate = new Date(date);
    let showLayout = await ShowSeatLayout.findOne({ event_id, date: showDate, time, language: language || '' });

    if (!showLayout) {
      const template = await SeatLayout.findOne({ event_id });
      if (!template) return res.status(404).json({ success: false, message: 'Seat layout template not found for this event' });

      // NOTE: We deliberately DO NOT persist price here.
      // Price is resolved dynamically via pricingRules.js when returning seat layout.
      const clonedLayout = template.layout_data.map(s => ({
        seatId: s.seatId,
        row: s.row,
        number: s.number,
        section: s.section,
        category: s.category,
        status: 'available',
        lockedBy: null,
        lockedAt: null,
        coords: s.coords
      }));

      const stageCopy = template.stage ? { ...template.stage } : undefined;

      showLayout = new ShowSeatLayout({ event_id, date: showDate, time, language: language || '', layout_data: clonedLayout, stage: stageCopy });
      await showLayout.save();
    }

    await showLayout.releaseExpired();

    const unavailableSeats = showLayout.layout_data.filter(seat => seat_ids.includes(seat.seatId) && seat.status !== 'available');

    if (unavailableSeats.length > 0) {
      return res.status(400).json({ success: false, message: 'Some seats are not available', unavailable_seats: unavailableSeats.map(seat => seat.seatId) });
    }

    const lockResult = await showLayout.lockSeats(seat_ids, session_id);
    if (!lockResult || !lockResult.success) {
      return res.status(400).json({ success: false, message: 'Failed to lock seats', unavailable_seats: lockResult?.conflicted || [] });
    }

    res.json({ success: true, message: 'Seats locked successfully', data: { seatLayout: lockResult.seatLayout } });
  } catch (error) {
    console.error('Lock seats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to lock seats',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Release specific seats (admin only)
exports.releaseSeats = async (req, res) => {
  try {
    const { event_id } = req.params;
    const { seat_ids } = req.body;

    if (!seat_ids || !Array.isArray(seat_ids) || seat_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Seat IDs are required'
      });
    }

    const { date, time, language } = req.body;

    if (date && time) {
      const showDate = new Date(date);
      const showLayout = await ShowSeatLayout.findOne({ event_id, date: showDate, time, language: language || '' });
      if (!showLayout) return res.status(404).json({ success: false, message: 'Show layout not found for this event/date/time' });
      await showLayout.releaseSeats(seat_ids);
      return res.json({ success: true, message: 'Seats released successfully', data: { released_seats: seat_ids, updated_layout: showLayout } });
    }

    const seatLayout = await SeatLayout.findOne({ event_id });
    if (!seatLayout) return res.status(404).json({ success: false, message: 'Seat layout not found for this event' });
    await seatLayout.releaseSeats(seat_ids);
    res.json({ success: true, message: 'Seats released successfully', data: { released_seats: seat_ids, updated_layout: seatLayout } });
  } catch (error) {
    console.error('Release seats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to release seats',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Publish seat layout for public use (admin only)
// Updated: Publish seat layout for public use (admin only) + Generate ShowSeatLayouts
exports.publishSeatLayout = async (req, res) => {
  try {
    const { event_id } = req.params;

    // Fetch and validate the base template
    const seatLayout = await SeatLayout.findOne({ event_id });
    if (!seatLayout) {
      return res.status(404).json({
        success: false,
        message: 'Seat layout not found for this event'
      });
    }

    if (seatLayout.is_published) {
      return res.status(400).json({
        success: false,
        message: 'Seat layout is already published'
      });
    }

    // Publish the template
    await seatLayout.publish();

    // Now bulk-generate ShowSeatLayouts based on event schedule
    const event = await Event.findById(event_id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const generatedShows = [];
    if (event.recurrence === 'daily' && event.dailySchedule) {
      const { startDate, endDate, timeSlots } = event.dailySchedule;
      let currentDate = new Date(startDate);
      const end = new Date(endDate);

      while (currentDate <= end) {
        for (const slot of timeSlots) {
          if (slot.isLangAvailable) {
            const showDate = new Date(currentDate); // Clone to avoid mutation
            const existingShow = await ShowSeatLayout.findOne({
              event_id,
              date: showDate,
              time: slot.time,
              language: slot.lang
            });

            if (!existingShow) {
              // Copy seats/layout_data from template - adjust field name based on your schema
              // Assuming template has 'seats' or 'layout_data'; use the correct one
              const newShow = new ShowSeatLayout({
                event_id,
                date: showDate,
                time: slot.time,
                language: slot.lang,
                // Copy seats/layout_data explicitly
                seats: seatLayout.seats || seatLayout.layout_data || [], // Fallback if field name varies
                layout_data: seatLayout.layout_data || seatLayout.seats || [], // Ensure both if schema uses one
                total_seats: seatLayout.total_seats || (seatLayout.seats?.length || 0), // Calculate if not set
                available_seats: seatLayout.total_seats || (seatLayout.seats?.length || 0), // Initially all available
                booked_seats: 0, // Default
                categories: seatLayout.categories, // Already working
                stage: seatLayout.stage, // Already present
                // Other defaults as needed
              });
              await newShow.save();
              generatedShows.push(newShow._id);
            }
          }
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    } else if (event.recurrence === 'specific' && event.specificSchedules?.length > 0) {
      for (const schedule of event.specificSchedules) {
        const showDate = new Date(schedule.date);
        for (const slot of schedule.timeSlots) {
          if (slot.isLangAvailable) {
            const existingShow = await ShowSeatLayout.findOne({
              event_id,
              date: showDate,
              time: slot.time,
              language: slot.lang
            });

            if (!existingShow) {
              const newShow = new ShowSeatLayout({
                event_id,
                date: showDate,
                time: slot.time,
                language: slot.lang,
                // Copy seats/layout_data explicitly
                seats: seatLayout.seats || seatLayout.layout_data || [],
                layout_data: seatLayout.layout_data || seatLayout.seats || [],
                total_seats: seatLayout.total_seats || (seatLayout.seats?.length || 0),
                available_seats: seatLayout.total_seats || (seatLayout.seats?.length || 0),
                booked_seats: 0,
                categories: seatLayout.categories,
                stage: seatLayout.stage,
              });
              await newShow.save();
              generatedShows.push(newShow._id);
            }
          }
        }
      }
    }

    res.json({
      success: true,
      message: 'Seat layout published successfully',
      data: {
        seatLayout,
        generatedShows: { count: generatedShows.length, ids: generatedShows }
      }
    });
  } catch (error) {
    console.error('Publish seat layout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to publish seat layout',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};