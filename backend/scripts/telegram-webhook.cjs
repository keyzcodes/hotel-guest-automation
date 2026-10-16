// Run only on your own PC. No token or webhook secret is printed.
require('dotenv').config({path: require('node:path').join(__dirname,'../.env')});
const { Api } = require('grammy');
async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is missing.');
  const api = new Api(process.env.TELEGRAM_BOT_TOKEN);
  const action = process.argv[2] || 'status';
  if (action === 'clear') {
    if (process.argv[3] !== '--confirm-hosted-bot-stopped') throw new Error('Stop the hosted service first, then pass --confirm-hosted-bot-stopped.');
    await api.deleteWebhook({drop_pending_updates:false});
    console.log('Webhook removed. Pending updates were retained. Local polling can now start.');
  } else if (action === 'status') {
    const info = await api.getWebhookInfo();
    console.log(JSON.stringify({configured: !!info.url, url:info.url || null, pendingUpdates:info.pending_update_count, lastError:info.last_error_message || null},null,2));
  } else throw new Error('Use status or clear.');
}
main().catch(error => { console.error('Webhook command failed:',error.name); process.exitCode=1; });
