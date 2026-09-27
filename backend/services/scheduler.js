const cron = require('node-cron');
const { sendWhatsAppMessage } = require('./whatsapp');

const scheduledJobs = new Map();

function scheduleQualityCheck(roomNumber, phoneNumber, delayMinutes = 15) {
  const jobId = `qc_${roomNumber}_${Date.now()}`;
  const targetTime = new Date(Date.now() + delayMinutes * 60 * 1000);
  const cronExpression = `${targetTime.getMinutes()} ${targetTime.getHours()} * * *`;

  console.log(`\n[ SCHEDULER ] Scheduled Quality Check for Room ${roomNumber} in ${delayMinutes} minutes.`);

  const task = cron.schedule(cronExpression, async () => {
    console.log(`\n[ SCHEDULER TRIGGERED ] Executing Quality Check for Room ${roomNumber}...`);
    
    const payload = {
      messaging_product: 'whatsapp',
      to: phoneNumber,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: `Hi there! You checked into Room ${roomNumber} recently. Is everything up to your expectations?`
        },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'qc_perfect', title: 'Everything Great 👌' } },
            { type: 'reply', reply: { id: 'qc_issue', title: 'Need Assistance 🛠️' } }
          ]
        }
      }
    };

    await sendWhatsAppMessage(payload);
    task.stop();
    scheduledJobs.delete(jobId);
  });

  scheduledJobs.set(jobId, task);
  return jobId;
}

module.exports = { scheduleQualityCheck };