const express = require('express');
const router = express.Router();

const {
  checkInGuest,
  getActiveBookings,
  confirmCheckout,
} = require('../controllers/bookingController');

router.post('/check-in', checkInGuest);
router.get('/active', getActiveBookings);
router.get('/feedback', require('../services/guestFeedbackService').getGuestFeedback);
router.post('/:id/checkout', confirmCheckout);

module.exports = router;