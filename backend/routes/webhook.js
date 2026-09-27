const express = require('express');
const router = express.Router();
const { sendWhatsAppMessage } = require('../services/whatsapp');

const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'hotel_ops_secret_token';

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log('[ WEBHOOK VERIFIED ] Meta webhook connected successfully.');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post('/', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      const from = message.from;

      if (message.type === 'interactive' && message.interactive.type === 'button_reply') {
        const buttonId = message.interactive.button_reply.id;

        console.log(`\n[ INBOUND GUEST ACTION ] Guest (${from}) clicked button ID: ${buttonId}`);

        if (buttonId === 'qc_issue') {
          console.log(`[ ALERT 🚨 ] Maintenance dispatched for guest ${from}`);
          
          await sendWhatsAppMessage({
            messaging_product: 'whatsapp',
            to: from,
            type: 'text',
            text: { body: 'We have notified front desk and maintenance. A staff member is on their way to assist you.' }
          });
        } else if (buttonId === 'qc_perfect') {
          await sendWhatsAppMessage({
            messaging_product: 'whatsapp',
            to: from,
            type: 'text',
            text: { body: 'Wonderful! Wish you a pleasant stay with us. 🌟' }
          });
        }
      }
    }
    return res.status(200).send('EVENT_RECEIVED');
  }

  return res.sendStatus(404);
});

module.exports = router;