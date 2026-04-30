const SeatLayout = require('../models/SeatLayout');
const ShowSeatLayout = require('../models/ShowSeatLayout');
const Event = require('../models/Event');

/**
 * Helper function to generate ShowSeatLayouts for an event
 * This checks for existing layouts and only creates missing ones
 * @param {string} event_id - The event ID
 * @returns {Promise<Object>} Result object with success status, message, count, and ids
 */
exports.generateShowSeatLayoutsForEvent = async (event_id) => {
    try {
        // Fetch the published seat layout template
        const seatLayout = await SeatLayout.findOne({ event_id });
        if (!seatLayout) {
            return { success: false, message: 'Seat layout template not found', count: 0 };
        }

        if (!seatLayout.is_published) {
            return { success: false, message: 'Seat layout is not published yet', count: 0 };
        }

        // Fetch the event
        const event = await Event.findById(event_id);
        if (!event) {
            return { success: false, message: 'Event not found', count: 0 };
        }

        const generatedShows = [];

        // Generate for daily schedule
        if (event.recurrence === 'daily' && event.dailySchedule) {
            const { startDate, endDate, timeSlots } = event.dailySchedule;
            let currentDate = new Date(startDate);
            const end = new Date(endDate);

            while (currentDate <= end) {
                for (const slot of timeSlots) {
                    if (slot.isLangAvailable) {
                        const showDate = new Date(currentDate);

                        // Check if ShowSeatLayout already exists
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
                currentDate.setDate(currentDate.getDate() + 1);
            }
        }
        // Generate for specific schedules
        else if (event.recurrence === 'specific' && event.specificSchedules?.length > 0) {
            for (const schedule of event.specificSchedules) {
                const showDate = new Date(schedule.date);
                for (const slot of schedule.timeSlots) {
                    if (slot.isLangAvailable) {
                        // Check if ShowSeatLayout already exists
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

        return {
            success: true,
            message: `Generated ${generatedShows.length} new ShowSeatLayouts`,
            count: generatedShows.length,
            ids: generatedShows
        };
    } catch (error) {
        console.error('Generate ShowSeatLayouts error:', error);
        return {
            success: false,
            message: 'Failed to generate ShowSeatLayouts',
            error: error.message,
            count: 0
        };
    }
};
