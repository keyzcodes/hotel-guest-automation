require('dotenv').config();
const { Bot } = require('grammy');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('❌ ERROR: TELEGRAM_BOT_TOKEN is missing from .env!');
  process.exit(1);
}

console.log('🤖 Initializing Telegram Bot connection via grammY...');

const bot = new Bot(token);

// Listen for incoming messages
bot.on('message:text', async (ctx) => {
  const chatId = ctx.chat.id;
  const username = ctx.from.first_name || 'Guest';
  const text = ctx.message.text;

  console.log(`📩 RECEIVED MESSAGE from ${username} (Chat ID: ${chatId}): "${text}"`);

  await ctx.reply(
    `🎉 Hello ${username}! Connection verified.\nYour Telegram Chat ID is: ${chatId}\n\nHotel Ops Bot is ready!`
  );
});

// Catch errors gracefully
bot.catch((err) => {
  console.error('❌ Bot Error:', err.message);
});

// Start bot
bot.start({
  onStart: (botInfo) => {
    console.log(`\n✅ SUCCESS! Bot Connected: @${botInfo.username} (${botInfo.first_name})`);
    console.log('----------------------------------------------------');
    console.log('📲 OPEN TELEGRAM ON YOUR PHONE:');
    console.log(`1. Search for @${botInfo.username}`);
    console.log('2. Send /start or "Hello"');
    console.log('3. Watch this terminal output!\n');
  }
});