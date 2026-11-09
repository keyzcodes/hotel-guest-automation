const express = require('express');
const mongoose = require('mongoose');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const { numberKey, transitions } = require('../services/roomInventory');
const router = express.Router();
const enabled = () => process.env.ROOM_BOARD_ENABLED === 'true';

router.get('/', async (req, res) => {
  if (!enabled()) return res.json({ enabled: false, rooms: [] });
  const rooms = await Room.find().select('number category housekeeping outOfOrder activeBookingId version').sort({ number: 1 }).lean();
  res.json({ enabled: true, rooms });
});
router.use((req, res, next) => enabled() ? next() : res.status(404).json({ message: 'Room board is disabled.' }));

router.post('/', async (req, res) => {
  if (req.staffSession?.staff?.role !== 'GM') return res.status(403).json({ message: 'Only the GM can add rooms.' });
  const number = numberKey(req.body?.number);
  const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
  if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(number) || !category || category.length > 48) {
    return res.status(400).json({ message: 'Enter a valid room number and category.' });
  }
  if (await Booking.exists({ roomNumber: number, stayStatus: { $in: ['ACTIVE', 'EXTENDED'] } }).collation({ locale: 'en', strength: 2 })) {
    return res.status(409).json({ message: 'This room already has an unmanaged active stay. Check that guest out before adding the room.' });
  }
  try {
    const room = await Room.create({ number, category });
    void require('../services/realtimeService').publishChange('Room');
    return res.status(201).json({ room });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'That room number already exists.' });
    throw error;
  }
});

router.post('/:id/action', async (req, res) => {
  const { action, version } = req.body || {};
  if (!mongoose.isObjectIdOrHexString(req.params.id) || !Object.hasOwn(transitions, action) || !Number.isInteger(version) || version < 0) {
    return res.status(400).json({ message: 'Invalid room action.' });
  }
  const { guard, set } = transitions[action];
  const room = await Room.findOneAndUpdate({ _id: req.params.id, version, activeBookingId: null, ...guard }, {
    $set: set, $inc: { version: 1 },
  }, { returnDocument: 'after', runValidators: true });
  if (!room) return res.status(409).json({ message: 'The room state changed. Refresh and try again.' });
  void require('../services/realtimeService').publishChange('Room');
  res.json({ room });
});

module.exports = router;
