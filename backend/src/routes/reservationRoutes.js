const express = require('express');
const mongoose = require('mongoose');
const Reservation = require('../models/Reservation');
const { normalizePhone } = require('../services/whatsappIdentity');
const { availableRooms, reserve, cancelReservation, RoomConflict } = require('../services/roomInventory');
const router = express.Router();

const enabled = () => process.env.ROOM_BOARD_ENABLED === 'true';
const lagosDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' });
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function readDates(source) {
  if (source?.arrivalDate !== undefined || source?.departureDate !== undefined) {
    if (source.arrivalAt !== undefined || source.departureAt !== undefined) return null;
    const policy = await require('../services/bookingWorkflowSettings').stayPolicy();
    const range = require('../services/bookingWorkflow').stayRange(source, policy, new Date());
    return range ? { arrivalAt: range.arrivalAt, departureAt: range.departureAt } : null;
  }
  const { arrivalAt, departureAt } = source ?? {};
  if (![arrivalAt, departureAt].every(value => typeof value === 'string' && iso.test(value))) return null;
  const arrival = new Date(arrivalAt);
  const departure = new Date(departureAt);
  if (!(arrival < departure && departure > new Date())) return null;
  if (arrival.toISOString() !== arrivalAt || departure.toISOString() !== departureAt) return null;
  // Reception can still book today's arrival after its planned time.
  if (lagosDate.format(arrival) < lagosDate.format(new Date())) return null;
  return { arrivalAt: arrival, departureAt: departure };
}

router.use((_req, res, next) => enabled() ? next() : res.status(404).json({ message: 'Reservations are unavailable.' }));
router.get('/', async (_req, res) => {
  const now = new Date();
  const reservations = await Reservation.find({ stayId: null, cancelledAt: null, departureAt: { $gt: now } })
    .select('guestName roomId roomNumber arrivalAt departureAt').sort({ arrivalAt: 1 }).lean();
  res.json({ reservations: reservations.map(item => ({ ...item, canArrive: item.arrivalAt <= now })) });
});
router.get('/availability', async (req, res) => {
  const dates = await readDates(req.query);
  if (!dates) return res.status(400).json({ message: 'Choose a valid arrival date and a later departure date.' });
  res.json({ rooms: await availableRooms(dates) });
});
router.post('/', async (req, res) => {
  const dates = await readDates(req.body);
  const { roomId } = req.body ?? {};
  const guestName = typeof req.body?.guestName === 'string' ? req.body.guestName.trim() : '';
  const guestPhone = normalizePhone(req.body?.guestPhone);
  if (!dates || !mongoose.isObjectIdOrHexString(roomId) || !guestName || guestName.length > 100 || !guestPhone) {
    return res.status(400).json({ message: 'Enter valid stay dates, a room, guest name and phone number.' });
  }
  try {
    const reservation = await reserve({ ...dates, roomId, guestName, guestPhone });
    res.status(201).json({ reservation: { _id: reservation._id, roomNumber: reservation.roomNumber } });
    notifyReservationChange();
  } catch (error) {
    if (error instanceof RoomConflict) return res.status(409).json({ message: error.message });
    throw error;
  }
});

router.post('/:id/cancel', async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) {
    return res.status(400).json({ message: 'Choose a valid reservation.' });
  }
  try {
    const reservation = await cancelReservation(req.params.id);
    if (!reservation) return res.status(404).json({ message: 'Reservation not found.' });
    res.json({ reservation: { _id: reservation._id, cancelledAt: reservation.cancelledAt } });
    notifyReservationChange();
  } catch (error) {
    if (error instanceof RoomConflict) return res.status(409).json({ message: error.message });
    throw error;
  }
});

function notifyReservationChange() {
  void require('../services/realtimeService').publishChange('Reservation').catch(error => {
    console.warn('Reservation refresh notification failed:', error.name);
  });
}

async function loadReservationForCheckIn(req, res, next) {
  const id = req.body?.reservationId;
  if (id === undefined) return next();
  if (!enabled() || !mongoose.isObjectIdOrHexString(id)) {
    return res.status(400).json({ success: false, message: 'Choose a valid reservation.' });
  }
  const reservation = await Reservation.findById(id).lean();
  if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });
  if (reservation.cancelledAt) {
    return res.status(409).json({ success: false, message: 'This reservation was cancelled. Refresh arrivals.' });
  }
  const now = new Date();
  if (reservation.stayId || reservation.arrivalAt > now || reservation.departureAt <= now) {
    return res.status(409).json({ success: false, message: 'This reservation cannot be checked in now. Refresh arrivals.' });
  }
  req.reservationId = reservation._id;
  req.body = {
    guestName: reservation.guestName,
    guestPhone: reservation.guestPhone,
    roomNumber: reservation.roomNumber,
    checkOutTime: reservation.departureAt.toISOString(),
  };
  return next();
}

module.exports = { router, loadReservationForCheckIn };
