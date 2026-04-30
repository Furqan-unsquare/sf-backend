// Dynamic pricing rules for show seats
// NOTE: This file contains ONLY pure pricing logic (no DB access)

/**
 * Get day name from Date (e.g. 'Monday', 'Tuesday').
 * Uses local server timezone.
 */
function getDayName(date) {
  if (!(date instanceof Date)) {
    throw new Error('getDayName: date must be a Date instance');
  }
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

/**
 * Core pricing resolver for a given date + time.
 * Returns an object mapping row letters A-J to prices.
 *
 * Rules:
 *  - Monday: no shows (should be validated at higher level)
 *  - Tuesday–Thursday:
 *      18:00 → First show (Hindi) – fixed matrix
 *      19:15 → Second show (English) – weekday matrix
 *  - Friday–Sunday:
 *      18:00 → First show (Hindi) – same matrix as Tue–Thu first show
 *      19:15 → Second show (Hindi) – weekend matrix (C row higher)
 */
function resolvePricing({ date, time }) {
  if (!date || !time) {
    throw new Error('resolvePricing requires { date, time }');
  }
  
  const d = date instanceof Date ? date : new Date(date);
  const day = getDayName(d);
  
  if (day === 'Monday') {
    throw new Error('No shows available on Monday');
  }
  
  if (time === '18:00') {
    const isWeekend = day === 'Saturday' || day === 'Sunday';
    return {
      A: 1500,
      B: 1000,
      C: isWeekend ? 1000 : 600,
      D: 600,
      E: 600,
      F: 600,
      G: 350,
      H: 350,
      I: 250,
      J: 250,
    };
  }

  if (time === '19:15') {
    const isWeekend = day === 'Saturday' || day === 'Sunday';

    if (isWeekend) {
      return {
        A: 1500,
        B: 1000,
        C: 1000,
        D: 200,
        E: 200,
        F: 200,
        G: 200,
        H: 200,
        I: 200,
        J: 200,
      };
    }

    // Weekday pricing (Tue–Fri) — language irrelevant for pricing
    return {
      A: 1500,
      B: 1000,
      C: 600,
      D: 200,
      E: 200,
      F: 200,
      G: 200,
      H: 200,
      I: 200,
      J: 200,
    };
  }

  throw new Error(`Unsupported show time for pricing: ${time}`);
}

/**
 * Helper: resolve a single seat price by row (A-J).
 *
 * @param {Object} params
 * @param {Date|String} params.date
 * @param {String} params.time - e.g. '18:00' or '19:15'
 * @param {String} params.row  - seat row, e.g. 'A'..'J'
 */
function resolveSeatPrice({ date, time, row }) {
  const pricing = resolvePricing({ date, time });
  const price = pricing[row];
  if (price == null) {
    throw new Error(`No price defined for row ${row} at time ${time}`);
  }
  return price;
}

module.exports = {
  getDayName,
  resolvePricing,
  resolveSeatPrice,
};
