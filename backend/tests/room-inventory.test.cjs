const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(initial = {}) {
  let room = { _id: 'room-101', number: '101', housekeeping: 'READY', outOfOrder: false, activeBookingId: null, version: 0, ...initial };
  let stays = [];
  let reservations = [];
  let nextId = 0;
  const session = {};
  const query = value => ({ collation() { return this; }, session(s) { assert.equal(s, session); return Promise.resolve(value); } });
  const find = value => ({
    select() { return this; },
    sort() { return this; },
    session(s) { assert.equal(s, session); return this; },
    lean() { return Promise.resolve(value); },
  });
  function Booking(data) { Object.assign(this, data, { _id: `booking-${++nextId}` }); }
  Booking.prototype.save = async function (options) { assert.equal(options.session, session); if (this.guestName === 'Invalid') throw Error('Validation failed'); stays.push({ ...this }); return this; };
  Booking.exists = ({ roomNumber, checkOutTime }) => query(stays.some(stay =>
    stay.roomNumber === roomNumber && ['ACTIVE', 'EXTENDED'].includes(stay.stayStatus)
      && (!checkOutTime || stay.checkOutTime > checkOutTime.$gt)));
  Booking.find = ({ checkOutTime }) => find(stays.filter(stay =>
    ['ACTIVE', 'EXTENDED'].includes(stay.stayStatus) && stay.checkOutTime > checkOutTime.$gt));
  function Reservation(data) { Object.assign(this, { _id: `reservation-${++nextId}`, stayId: null }, data); }
  Reservation.prototype.save = async function ({ session: supplied }) {
    assert.equal(supplied, session);
    reservations.push({ ...this });
    return this;
  };
  Reservation.distinct = (field, filter) => {
    assert.equal(field, 'roomId');
    return query(reservations.filter(item =>
      !item.stayId && (!Object.hasOwn(filter, 'cancelledAt') || item.cancelledAt == null) &&
      item._id !== filter._id?.$ne &&
      item.arrivalAt < filter.arrivalAt.$lt && item.departureAt > filter.departureAt.$gt
    ).map(item => item.roomId));
  };
  Reservation.updateOne = async (filter, update, options) => {
    assert.equal(options.session, session);
    const item = reservations.find(item =>
      item._id === filter._id && item.roomId === filter.roomId && !item.stayId &&
      (!Object.hasOwn(filter, 'cancelledAt') || item.cancelledAt == null) &&
      item.arrivalAt <= filter.arrivalAt.$lte && +item.departureAt === +filter.departureAt);
    if (!item) return { matchedCount: 0 };
    Object.assign(item, update.$set);
    return { matchedCount: 1 };
  };
  Reservation.findById = async id => reservations.find(item => item._id === id) ?? null;
  Reservation.findOneAndUpdate = async (filter, update) => {
    const item = reservations.find(item => item._id === filter._id && !item.stayId && item.cancelledAt == null);
    return item ? Object.assign(item, update.$set) : null;
  };
  Booking.findOneAndUpdate = async ({_id}, update, options) => { assert.equal(options.session, session); const s = stays.find(x => x._id === _id && ['ACTIVE','EXTENDED'].includes(x.stayStatus)); return s ? Object.assign(s, update.$set) : null; };
  const Room = {
    find: ({ outOfOrder }) => find(room.outOfOrder === outOfOrder ? [room] : []),
    findOne: filter => query(Object.entries(filter).every(([key, value]) => room[key] === value) ? room : null),
    updateOne: async (guard, update, options) => { assert.equal(options.session, session); if (Object.entries(guard).some(([k, v]) => room[k] !== v)) return {matchedCount:0}; Object.assign(room,update.$set); room.version += update.$inc.version; return {matchedCount:1}; },
  };
  const mongoose = {connection:{transaction:async work => {const before=structuredClone([room,stays,reservations]);try{return await work(session);}catch(e){[room,stays,reservations]=before;throw e;}}}};
  const module={exports:{}};
  const deps={mongoose,'../models/Room':Room,'../models/Booking':Booking,'../models/Reservation':Reservation};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/services/roomInventory.js'),'utf8'),{module,process:{env:{}},require:k=>deps[k]});
  return {service:module.exports,room:()=>room,stays:()=>stays,reservations:()=>reservations};
}
const today = new Date('2026-11-07T13:00:00Z');
const tomorrowCheckout = new Date('2026-11-08T10:00:00Z');
const tomorrowArrival = new Date('2026-11-08T13:00:00Z');
const nextCheckout = new Date('2026-11-09T10:00:00Z');
const data = {
  roomNumber: '101', guestName: 'Sample guest', stayStatus: 'ACTIVE',
  checkInTime: today, checkOutTime: tomorrowCheckout,
};
const advance = {
  roomId: 'room-101', guestName: 'Reserved guest', arrivalAt: tomorrowArrival, departureAt: nextCheckout,
};
test('check-in assigns the booking and checkout releases the room dirty exactly once', async () => {
  const {service,room}=fixture();
  const stay=await service.checkIn(data);
  assert.equal(room().activeBookingId,stay._id);
  await assert.rejects(service.checkIn(data),{name:'RoomConflict'});
  await service.checkOut(stay._id);
  assert.equal(room().activeBookingId,null);
  assert.equal(room().housekeeping,'DIRTY');
  const version=room().version;
  assert.equal(await service.checkOut(stay._id),null);
  assert.equal(room().version,version);
});
test('dirty and blocked rooms are rejected, and a failed stay save rolls back its assignment',async()=>{
  for(const initial of [{housekeeping:'DIRTY'},{outOfOrder:true}]){
    const f=fixture(initial);await assert.rejects(f.service.checkIn(data),{name:'RoomConflict'});assert.equal(f.stays().length,0);
  }
  const f=fixture();await assert.rejects(f.service.checkIn({...data,guestName:'Invalid'}),/Validation failed/);assert.equal(f.room().activeBookingId,null);
});


test('an occupied room accepts a future reservation, rejects overlaps and converts the reservation only when ready', async () => {
  const f = fixture();
  const current = await f.service.checkIn(data);
  await assert.rejects(f.service.reserve({ ...advance, arrivalAt: today }), /already committed/);
  const reserved = await f.service.reserve(advance);
  await assert.rejects(f.service.reserve(advance), /already committed/);
  const arrival = { ...data, guestName: advance.guestName, checkInTime: tomorrowArrival, checkOutTime: nextCheckout };
  await assert.rejects(f.service.checkIn(arrival, reserved._id), /already has an active stay/);
  await f.service.checkOut(current._id);
  await assert.rejects(f.service.checkIn(arrival, reserved._id), /no longer ready/);
  f.room().housekeeping = 'READY';
  await assert.rejects(f.service.checkIn(arrival), /reserved during/);
  await assert.rejects(f.service.checkIn({ ...arrival, checkInTime: today }, reserved._id), /reservation has changed/);
  assert.equal(f.room().activeBookingId, null);
  await assert.rejects(f.service.checkIn({ ...arrival, guestName: 'Invalid' }, reserved._id), /Validation failed/);
  assert.equal(f.reservations()[0].stayId, null);
  const stay = await f.service.checkIn(arrival, reserved._id);
  assert.equal(f.reservations()[0].stayId, stay._id);
  assert.equal(f.room().activeBookingId, stay._id);
  await f.service.checkOut(stay._id);
  f.room().housekeeping = 'READY';
  await assert.rejects(f.service.checkIn(arrival, reserved._id), /reservation has changed/);
});

test('departures and arrivals at the same time do not overlap', async () => {
  const f = fixture();
  await f.service.reserve(advance);
  await f.service.reserve({ ...advance, arrivalAt: nextCheckout, departureAt: new Date(+nextCheckout + 3600000) });
  assert.equal(f.reservations().length, 2);
});


test('cancellation preserves the record, frees the room dates and blocks stale check-in', async () => {
  const f = fixture();
  const reserved = await f.service.reserve(advance);
  const cancelled = await f.service.cancelReservation(reserved._id);
  assert.ok(Number.isFinite(+cancelled.cancelledAt));
  assert.equal((await f.service.cancelReservation(reserved._id)).cancelledAt, cancelled.cancelledAt);
  const arrival = { ...data, checkInTime: tomorrowArrival, checkOutTime: nextCheckout };
  await assert.rejects(f.service.checkIn(arrival, reserved._id), /reservation has changed/);
  assert.equal(f.room().activeBookingId, null);
  const replacement = await f.service.reserve(advance);
  await f.service.checkIn(arrival, replacement._id);
  await assert.rejects(f.service.cancelReservation(replacement._id), /already checked in/);
  assert.equal(f.reservations().length, 2);
});


test('availability reads rooms, reservations and active stays in one session', async () => {
  const f = fixture();
  const numbers = async dates => (await f.service.availableRooms(dates)).map(room => room.number).join(',');
  assert.equal(await numbers(advance), '101');
  const reservation = await f.service.reserve(advance);
  assert.equal(await numbers(advance), '');
  await f.service.checkIn({
    ...data, checkInTime: tomorrowArrival, checkOutTime: nextCheckout,
  }, reservation._id);
  assert.equal(await numbers(advance), '');
  assert.equal(await numbers({ arrivalAt: nextCheckout, departureAt: new Date(+nextCheckout + 3600000) }), '101');
  f.room().outOfOrder = true;
  assert.equal(await numbers({ arrivalAt: nextCheckout, departureAt: new Date(+nextCheckout + 3600000) }), '');
});
