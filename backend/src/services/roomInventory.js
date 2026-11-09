const mongoose = require('mongoose');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const Reservation = require('../models/Reservation');

const active = { $in: ['ACTIVE', 'EXTENDED'] };
const readyRoom = { housekeeping: 'READY', outOfOrder: false, activeBookingId: null };
const numberKey = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
class RoomConflict extends Error {
  constructor(message) { super(message); this.name = 'RoomConflict'; }
}

async function reservedRooms({ arrivalAt, departureAt }, session, reservationId) {
  const filter = { stayId: null, cancelledAt: null, arrivalAt: { $lt: departureAt }, departureAt: { $gt: arrivalAt } };
  if (reservationId) filter._id = { $ne: reservationId };
  const ids = await Reservation.distinct('roomId', filter).session(session ?? null);
  return new Set(ids.map(String));
}

async function availableRooms(dates) {
  return mongoose.connection.transaction(async session => {
    // Read room, reservation and stay state from the same snapshot. A conversion
    // can otherwise disappear from one read before it appears in the other.
    const rooms = await Room.find({ outOfOrder: false }).select('number category').sort({ number: 1 }).session(session).lean();
    const held = await reservedRooms(dates, session);
    const currentStays = await Booking.find({
      stayStatus: active, checkOutTime: { $gt: dates.arrivalAt },
    }).select('roomNumber').session(session).lean();
    const occupied = new Set(currentStays.map(stay => numberKey(stay.roomNumber)));
    return rooms.filter(room => !held.has(String(room._id)) && !occupied.has(room.number));
  }, { readConcern: { level: 'snapshot' } });
}

async function reserve(data) {
  return mongoose.connection.transaction(async session => {
    const room = await Room.findOne({ _id: data.roomId, outOfOrder: false }).session(session);
    if (!room) throw new RoomConflict('This room is unavailable. Check availability again.');
    const { arrivalAt, departureAt } = data;
    const held = await reservedRooms({ arrivalAt, departureAt }, session);
    const occupied = await Booking.exists({
      roomNumber: room.number, stayStatus: active, checkOutTime: { $gt: arrivalAt },
    }).collation({ locale: 'en', strength: 2 }).session(session);
    if (occupied || held.has(String(room._id))) {
      throw new RoomConflict('This room is already committed for part of the stay. Choose another room or dates.');
    }
    // All allocations for the same room write this document, even for a future stay.
    // MongoDB retries write conflicts against a fresh snapshot.
    const locked = await Room.updateOne({ _id: room._id, outOfOrder: false }, {
      $inc: { version: 1 },
    }, { session });
    if (!locked.matchedCount) throw new RoomConflict('The room changed. Check availability again.');
    return new Reservation({ ...data, roomNumber: room.number }).save({ session });
  });
}

async function cancelReservation(id) {
  const cancelled = await Reservation.findOneAndUpdate({
    _id: id, stayId: null, cancelledAt: null,
  }, { $set: { cancelledAt: new Date() } }, { returnDocument: 'after' });
  if (cancelled) return cancelled;

  const reservation = await Reservation.findById(id);
  if (reservation?.stayId) throw new RoomConflict('The guest has already checked in. Open Stays to manage the visit.');
  return reservation;
}

async function checkIn(data, reservationId) {
  return mongoose.connection.transaction(async session => {
    const number = numberKey(data.roomNumber);
    const room = await Room.findOne({ number }).session(session);
    if (!room) throw new RoomConflict('Choose a room from the room board.');
    if (await Booking.exists({ roomNumber: number, stayStatus: active }).collation({ locale: 'en', strength: 2 }).session(session)) {
      throw new RoomConflict('That room already has an active stay.');
    }
    const held = await reservedRooms({ arrivalAt: data.checkInTime, departureAt: data.checkOutTime }, session, reservationId);
    if (held.has(String(room._id))) {
      throw new RoomConflict('This room is reserved during the requested stay. Choose another room or checkout time.');
    }
    // This conditional write is the contention point for parallel assignments.
    // The stay and room pointer commit together; transaction retries recheck state.
    const booking = new Booking({ ...data, roomNumber: number, roomId: room._id });
    const claimed = await Room.updateOne({ _id: room._id, ...readyRoom }, {
      $set: { activeBookingId: booking._id }, $inc: { version: 1 },
    }, { session });
    if (!claimed.matchedCount) throw new RoomConflict('That room is no longer ready for check-in. Refresh and choose another room.');
    if (reservationId) {
      const converted = await Reservation.updateOne({
        _id: reservationId, roomId: room._id, stayId: null, cancelledAt: null,
        arrivalAt: { $lte: data.checkInTime }, departureAt: data.checkOutTime,
      }, { $set: { stayId: booking._id } }, { session });
      if (!converted.matchedCount) throw new RoomConflict('This reservation has changed. Refresh arrivals.');
    }
    return booking.save({ session });
  });
}

async function checkOut(id) {
  return mongoose.connection.transaction(async session => {
    const booking = await Booking.findOneAndUpdate({ _id: id, stayStatus: active }, {
      $set: { stayStatus: 'COMPLETED', confirmedCheckoutAt: new Date(), extensionPromptMessageId: null },
    }, { session, returnDocument: 'after', runValidators: true });
    if (!booking?.roomId) return booking;
    const released = await Room.updateOne({ _id: booking.roomId, activeBookingId: booking._id }, {
      $set: { activeBookingId: null, housekeeping: 'DIRTY' }, $inc: { version: 1 },
    }, { session });
    if (!released.matchedCount) throw new RoomConflict('Room assignment could not be verified. Refresh before retrying.');
    return booking;
  });
}

const transitions = {
  ready: { guard: { outOfOrder: false, housekeeping: 'DIRTY' }, set: { housekeeping: 'READY' } },
  'out-of-order': { guard: { outOfOrder: false }, set: { outOfOrder: true } },
  'return-to-service': { guard: { outOfOrder: true }, set: { outOfOrder: false, housekeeping: 'DIRTY' } },
};

module.exports = { availableRooms, reserve, cancelReservation, checkIn, checkOut, numberKey, RoomConflict, transitions };
