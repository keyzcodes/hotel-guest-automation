const dayMs = 86400000;
const lagosDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' });
const displayDate = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium' });
const clean = (value, limit) => typeof value === 'string' && value.trim().length <= limit ? value.trim() : '';
const dateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const money = (minor, currency) => new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: minor % 100 ? 2 : 0, minimumFractionDigits: 0 }).format(minor / 100);
const datesText = quote => `${displayDate.format(new Date(quote.arrivalAt))} to ${displayDate.format(new Date(quote.departureAt))}`;

function stayRange(details, settings, now) {
  const { arrivalDate, departureDate } = details;
  const { checkInTime, checkOutTime } = settings;
  const time = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!dateOnly(arrivalDate) || !dateOnly(departureDate) || !time(checkInTime) || !time(checkOutTime)) return null;
  const arrivalAt = new Date(`${arrivalDate}T${checkInTime}:00+01:00`);
  const departureAt = new Date(`${departureDate}T${checkOutTime}:00+01:00`);
  if (!Number.isFinite(+arrivalAt) || !Number.isFinite(+departureAt) || lagosDay.format(arrivalAt) !== arrivalDate ||
      lagosDay.format(departureAt) !== departureDate || arrivalDate < lagosDay.format(now) || departureDate <= arrivalDate) return null;
  const nights = (Date.parse(departureDate) - Date.parse(arrivalDate)) / dayMs;
  return { arrivalAt, departureAt, nights };
}

function quoteReply(quote) {
  const total = money(quote.totalMinor, quote.currency);
  const deposit = quote.depositMinor ? ` The required deposit is ${money(quote.depositMinor, quote.currency)}.` : '';
  return `${quote.category} is available for ${datesText(quote)} at ${total} total.${deposit} Would you like to go ahead?`;
}

function sameOffer(a, b) {
  return a && b && a.category === b.category && a.currency === b.currency &&
    a.totalMinor === b.totalMinor && a.depositMinor === b.depositMinor &&
    +new Date(a.arrivalAt) === +new Date(b.arrivalAt) && +new Date(a.departureAt) === +new Date(b.departureAt);
}

function policyTime(value) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('Invalid hotel policy hours.');
  const [hour, minute] = value.split(':');
  if (hour === '12' && minute === '00') return '12 noon';
  return `${Number(hour) % 12 || 12}:${minute} ${Number(hour) >= 12 ? 'PM' : 'AM'}`;
}

function approvedQuote(settings, range, rate, now) {
  const totalMinor = rate.nightlyMinor * range.nights;
  const depositMinor = Math.round(totalMinor * settings.depositPercent / 100);
  if (settings.currency !== 'NGN' || !Number.isSafeInteger(totalMinor) || totalMinor <= 0 ||
      !Number.isInteger(settings.depositPercent) || settings.depositPercent < 0 || settings.depositPercent > 100 ||
      !Number.isInteger(settings.quoteMinutes) || settings.quoteMinutes < 1 || settings.quoteMinutes > 1440) {
    throw Error('Booking settings are invalid.');
  }
  return {
    ...range, category: rate.category, currency: settings.currency, totalMinor, depositMinor,
    expiresAt: new Date(+now + settings.quoteMinutes * 60000),
  };
}

function describeQuote(quote) {
  if (!quote) return { reply: 'Which dates would you like me to check for a price?', conversational: true };
  const total = money(quote.totalMinor, quote.currency);
  const nightly = money(quote.totalMinor / quote.nights, quote.currency);
  const deposit = quote.depositMinor ? ` The deposit in that quote was ${money(quote.depositMinor, quote.currency)}.` : '';
  return {
    reply: `The last quote for ${quote.category} was ${nightly} per night, with a total of ${total} for ${quote.nights} night(s).${deposit}`,
    conversational: true,
  };
}

function dateAfterNights(arrivalDate, nights) {
  if (!dateOnly(arrivalDate)) return null;
  const arrival = new Date(arrivalDate);
  if (!Number.isFinite(+arrival) || arrival.toISOString().slice(0, 10) !== arrivalDate) return null;
  return new Date(+arrival + nights * dayMs).toISOString().slice(0, 10);
}

const pendingReply = 'Your booking request is with reception for review. I’ll message you when they record a decision.';

function describeStay(details = {}) {
  const parts = [];
  const category = clean(details.category, 48);
  if (category) parts.push(category);
  const validDates = [details.arrivalDate, details.departureDate].every(value =>
    dateOnly(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  if (validDates) parts.push(datesText({ arrivalAt: details.arrivalDate, departureAt: details.departureDate }));
  if (Number.isInteger(details.guests) && details.guests > 0) {
    parts.push(`${details.guests} ${details.guests === 1 ? 'guest' : 'guests'}`);
  }
  return parts.join(', ');
}

function currentStatus(current) {
  if (current?.state === 'CANCELLED') return 'That reservation has been cancelled. I can check new dates or room options for you.';
  if (current?.state === 'CONFIRMED') return `Your booking is confirmed. Your reference is ${current.reservationId}.`;
  if (current?.state === 'DECLINED') return 'Reception couldn’t confirm that booking request. I can check new dates or room options for you.';
  const summary = describeStay({ ...current?.details, category: current?.details?.category ?? current?.quote?.category });
  const recap = summary ? `Your enquiry is for ${summary}. ` : '';
  if (current?.state === 'PENDING') return recap + pendingReply;
  if (current?.state === 'NEEDS_DETAILS') return recap + current.staffQuestion;
  if (current?.state === 'QUOTED') return recap + 'Your room is at the quote stage. Reply if you would like to go ahead.';
  return recap + 'Please share any missing stay details if you’d like me to check availability.';
}

async function advance({ decision, current, settings, availableRooms, now, text }) {
  if (decision.intent === 'PRICE') return describeQuote(current?.quote);
  if (decision.intent === 'STATUS') return { reply: currentStatus(current) };
  if (current?.state === 'PENDING') return { reply: pendingReply };
  const extraNights = Number.isInteger(decision.extraNights) && decision.extraNights > 0 ? decision.extraNights : null;
  const duration = Number.isInteger(decision.nights) ? decision.nights
    : extraNights && current?.open && current.quote?.nights ? current.quote.nights + extraNights : null;
  const nights = duration > 0 && duration <= 365 ? duration : null;
  if (nights === null && (decision.nights !== undefined || decision.extraNights !== undefined)) {
    return { reply: 'How many nights would you like to stay in total?', conversational: true };
  }
  const changesStay = current?.state === 'NEEDS_DETAILS' && (
    (nights !== null && nights !== current.quote.nights) ||
    ['arrivalDate', 'departureDate'].some(key => dateOnly(decision[key]) && decision[key] !== current.details[key]) ||
    (Number.isInteger(decision.guests) && decision.guests > 0 && decision.guests <= 99 && decision.guests !== current.details.guests) ||
    (clean(decision.category, 48) && decision.category.trim().toLowerCase() !== current.quote.category.toLowerCase())
  );
  if (current?.state === 'NEEDS_DETAILS' && !changesStay) {
    const answer = clean(text, 4000);
    if (!answer) return { reply: current.staffQuestion };
    return {
      next: { state: 'PENDING', guestAnswer: answer },
      reply: 'Thanks. I’ve added your reply to the request for reception.',
    };
  }
  if (decision.intent === 'ACCEPT' && ['CONFIRMED', 'DECLINED', 'CANCELLED'].includes(current?.state)) return { reply: currentStatus(current) };

  const active = current?.open ? current : null;
  const details = { ...active?.details };
  for (const key of ['arrivalDate', 'departureDate']) {
    if (dateOnly(decision[key])) details[key] = decision[key];
  }
  for (const [key, limit] of [['category', 48], ['guestName', 100]]) {
    const value = clean(decision[key], limit);
    if (value) details[key] = value;
  }
  if (Number.isInteger(decision.guests) && decision.guests > 0 && decision.guests <= 99) details.guests = decision.guests;

  const hold = reply => ({ next: { state: 'COLLECTING', details, quote: null, staffQuestion: null, guestAnswer: null }, reply, conversational: true });
  const requestedNights = nights ?? details.requestedNights;
  if (requestedNights && !dateOnly(decision.departureDate)) {
    const departureDate = dateAfterNights(details.arrivalDate, requestedNights);
    if (!departureDate || details.arrivalDate < lagosDay.format(now)) {
      details.requestedNights = requestedNights;
      return hold('What date would you like to check in?');
    }
    details.departureDate = departureDate;
  }
  delete details.requestedNights;
  const range = stayRange(details, settings, now);
  if (!range) return hold('What are your check-in and checkout dates?');
  if (!details.guests) return hold('How many guests will be staying?');

  const rooms = await availableRooms(range);
  if (!Array.isArray(settings.roomRates)) throw Error('Booking rates are unavailable.');
  const rates = settings.roomRates.filter(rate => Number.isSafeInteger(rate.nightlyMinor) && rate.nightlyMinor > 0 &&
    Number.isInteger(rate.capacity) && rate.capacity >= details.guests && rooms.some(room => room.category === rate.category));
  const chosen = details.category
    ? rates.find(rate => rate.category.toLowerCase() === details.category.toLowerCase())
    : rates[0];
  if (!chosen) return hold(rates.length
    ? `I can offer ${rates.map(rate => rate.category).join(', ')} for those dates. Which would you prefer?`
    : 'I don’t have a room to offer for those dates and guest count. Would different dates work?');

  const quote = approvedQuote(settings, range, chosen, now);
  const prior = active?.quote;
  const accepted = active?.state === 'QUOTED' && (decision.intent === 'ACCEPT' ||
    (decision.intent === 'DETAILS' && !active.details.guestName && details.guestName && active.details.awaitingName));
  if (accepted && nights === null && +new Date(prior?.expiresAt) > +now && details.guests === active.details.guests && sameOffer(prior, quote)) {
    if (!details.guestName) return {
      next: { state: 'QUOTED', details: { ...details, awaitingName: true }, quote: prior },
      reply: 'What name should reception put on the booking request?',
      conversational: true,
    };
    return { next: { state: 'PENDING', details: { ...details, awaitingName: false }, quote: prior }, reply: pendingReply };
  }
  const quoteTerms = `This quote is valid for ${settings.quoteMinutes} minutes and does not hold a room.`;
  return {
    next: { state: 'QUOTED', details: { ...details, awaitingName: false }, quote, staffQuestion: null, guestAnswer: null },
    reply: quoteReply(quote) + ' ' + quoteTerms,
    conversational: true,
    quoteTerms,
  };
}

module.exports = { advance, stayRange, datesText, currentStatus, approvedQuote, describeStay, policyTime };
