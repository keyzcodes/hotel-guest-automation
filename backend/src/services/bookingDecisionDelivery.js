const Message = require('../models/Message');
const settings = require('./bookingWorkflowSettings');
const transport = require('./whatsappService');

const queued = {
  channel: 'WHATSAPP', direction: 'OUTBOUND',
  idempotencyKey: { $regex: '^BOOKING_DECISION:' },
  deliveryState: 'PENDING',
};
let timer;
let running;

async function tick() {
  // An expired claim may have reached WhatsApp. Surface it for staff review.
  await Message.updateMany({
    ...queued, processingStatus: 'PROCESSING', updatedAt: { $lt: new Date(Date.now() - 120000) },
  }, { $set: { deliveryState: 'UNKNOWN', processingStatus: 'NOT_APPLICABLE' } });
  if (!transport.isConnected()) return;
  const message = await Message.findOneAndUpdate({
    ...queued, processingStatus: 'NOT_APPLICABLE',
  }, { $set: { processingStatus: 'PROCESSING' } }, {
    sort: { createdAt: 1, _id: 1 }, returnDocument: 'after',
  });
  if (!message) return;

  let timeout;
  try {
    const sent = await Promise.race([
      transport.sendStaffReply(message.chatId, message.text),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Send timeout')), 20000); }),
    ]);
    if (!sent?.message_id) throw Error('Missing WhatsApp submission ID.');
    await Message.updateOne({ _id: message._id, ...queued }, { $set: {
      processingStatus: 'NOT_APPLICABLE', deliveryState: 'SENT', providerMessageId: String(sent.message_id),
    } });
  } catch {
    await Message.updateOne({ _id: message._id, ...queued }, { $set: {
      processingStatus: 'NOT_APPLICABLE', deliveryState: 'UNKNOWN',
      lastError: 'WhatsApp submission could not be confirmed. Check the guest chat.',
    } });
  } finally {
    clearTimeout(timeout);
  }
}

function start() {
  if (timer || !settings.enabled()) return;
  const poll = () => {
    if (!running) running = tick()
      .catch(error => console.error('Booking decision delivery failed:', error.name))
      .finally(() => { running = null; });
  };
  timer = setInterval(poll, 2000);
  timer.unref();
  poll();
}

async function stop() {
  clearInterval(timer);
  timer = null;
  await running;
}

module.exports = { start, stop };
