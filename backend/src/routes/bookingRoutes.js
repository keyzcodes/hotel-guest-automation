const express = require('express');
const router = express.Router();
const { checkInGuest, getActiveBookings } = require('../controllers/bookingController');

router.post('/check-in', checkInGuest);
router.get('/active', getActiveBookings);

module.exports = router;