const express = require('express');
const router = express.Router();
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { scheduleQualityCheck } = require('../services/scheduler');
const hotelConfig = require('../config/hotel');

router.post('/checkin', async (req, res) => {
  const { roomNumber, phoneNumber } = req.body;

  if (!roomNumber || !phoneNumber) {
    return res.status(400).json({ error: 'roomNumber and phoneNumber are required.' });
  }

  const welcomePayload = {
    messaging_product: 'whatsapp',
    to: phoneNumber,
    type: 'text',
    text: {
      body: `Welcome to ${hotelConfig.name}! 🏨\n\nYour Room: ${roomNumber}\nWi-Fi SSID: ${hotelConfig.wifiSSID}\nWi-Fi Pass: ${hotelConfig.wifiPassword}\n\nReply to this message anytime if you need assistance!`
    }
  };

  const dispatchResult = await sendWhatsAppMessage(welcomePayload);
  const jobId = scheduleQualityCheck(roomNumber, phoneNumber, 15);

  return res.json({
    status: 'success',
    message: `Check-in executed for Room ${roomNumber}. Automated 15-min Quality Check queued.`,
    scheduledJobId: jobId,
    dispatchResult
  });
});

module.exports = router;