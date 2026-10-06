const cron = require('node-cron');
const { sendWhatsAppTemplate } = require('./whatsapp');
const Room = require('../models/Room');

// Runs every 15 minutes to check for upcoming check-outs
const initCheckoutScheduler = () => {
  cron.schedule('*/15 * * * *', async () => {
    const now = new Date();
    const targetNoticeWindow = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour ahead

    try {
      // Find guests checking out in ~1 hour who haven't received notice yet
      const roomsToNotify = await Room.find({
        status: { $in: ['QC_PASSED', 'ARRIVED'] },
        checkoutNoticeSent: false,
        checkoutTime: { $lte: targetNoticeWindow,$gt: now }
      });

      for (const room of roomsToNotify) {
        await sendWhatsAppTemplate(room.guestPhone, 'checkout_reminder_template', [
          { type: 'text', text: room.roomNumber },
          { type: 'text', text: '12:00 PM' }
        ]);

        room.status = 'PRE_CHECKOUT_NOTICE';
        room.checkoutNoticeSent = true;
        await room.save();

        console.log(`[Checkout Notice] Dispatched to Room ${room.roomNumber}`);
      }
    } catch (error) {
      console.error('Checkout Scheduler Error:', error);
    }
  });
};

module.exports = {
  initCheckoutScheduler
};