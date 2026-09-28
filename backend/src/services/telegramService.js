const { Bot, InlineKeyboard } = require('grammy');
const { GoogleGenAI } = require('@google/genai');
const TaskTicket = require('../models/TaskTicket');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN is missing in .env');
}

const bot = new Bot(token);

// Initialize Gemini Client (uses GEMINI_API_KEY from .env)
const ai = new GoogleGenAI();

/**
 * Helper function for smart, low-latency retries on transient 503 errors
 */
async function callGeminiWithRetry(contents, retries = 2, delay = 400) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: contents
      });
    } catch (error) {
      const isTransient = error.status === 503 || error.code === 503 || error.message.includes('fetch failed');
      
      if (!isTransient || attempt === retries) {
        throw error;
      }

      console.warn(`⚠️ Gemini 503 encountered. Retrying attempt ${attempt} in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; 
    }
  }
}

/**
 * 1. Send Check-In Welcome Message
 */
const sendWelcomeMessage = async (chatId, guestName, roomNumber) => {
  const text = `🏨 *Welcome to Grand Hotel, ${guestName}!*\n\nYour check-in for *Room ${roomNumber}* is confirmed. Virtual room power is now *ACTIVE* ⚡.\n\nYou can message us here anytime during your stay for assistance, housekeeping, or room service!`;
  
  return await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
};

/**
 * 2. Send 15-Minute Satisfaction Pulse Check (Interactive Inline Buttons)
 */
const sendSatisfactionCheck = async (chatId, guestName, roomNumber) => {
  const text = `👋 Hi ${guestName}, we hope you are settling into Room ${roomNumber} smoothly!\n\nIs everything up to your expectations so far?`;
  
  const keyboard = new InlineKeyboard()
    .text('👍 Everything is Great', `PULSE_GOOD_${roomNumber}`)
    .text('🛠️ I Need Assistance', `PULSE_ISSUE_${roomNumber}`);

  return await bot.api.sendMessage(chatId, text, { reply_markup: keyboard });
};

/**
 * 3. Send 30-Minute Pre-Checkout Prompt
 */
const sendPreCheckoutPrompt = async (chatId, roomNumber) => {
  const text = `⏰ *Upcoming Check-Out Alert*\n\nYour check-out for Room ${roomNumber} is scheduled in 30 minutes.\nWould you like to extend your stay or prepare for check-out?`;

  const keyboard = new InlineKeyboard()
    .text('✅ Check-Out Now', `CHECKOUT_NOW_${roomNumber}`)
    .text('⏳ Extend Stay (+1 Hr)', `EXTEND_STAY_${roomNumber}`);

  return await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
};

/**
 * 4. Send Post-Checkout Rating & Google Review Shield
 */
const sendReviewPrompt = async (chatId) => {
  const text = `🌟 *Thank you for staying with us!*\n\nHow would you rate your overall stay experience with us today?`;

  const keyboard = new InlineKeyboard()
    .text('⭐ 1', 'RATING_1')
    .text('⭐ 2', 'RATING_2')
    .text('⭐ 3', 'RATING_3')
    .text('⭐ 4', 'RATING_4')
    .text('⭐ 5', 'RATING_5');

  return await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
};

/**
 * Listen for Interactive Button Presses (Callback Queries)
 */
bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery(); // Stops loading spinner on mobile

  if (data.startsWith('PULSE_GOOD')) {
    await ctx.reply('😊 We are thrilled to hear that! Enjoy your stay.');
  } 
  else if (data.startsWith('PULSE_ISSUE')) {
    await ctx.reply('🚨 We apologize! Our front desk has been alerted and will attend to your room shortly. What issue are you experiencing?');
  } 
  else if (data.startsWith('CHECKOUT_NOW')) {
    await ctx.reply('👍 Thank you! Please drop your keycard at the front desk when leaving.');
  } 
  else if (data.startsWith('EXTEND_STAY')) {
    await ctx.reply('📩 Your request for a 1-hour stay extension has been sent to the front desk.');
  } 
  else if (data === 'RATING_4' || data === 'RATING_5') {
    const googleReviewUrl = 'https://search.google.com/local/writereview?placeid=YOUR_GOOGLE_PLACE_ID';
    await ctx.reply(`🎉 Thank you so much! We would really appreciate it if you could share your experience on our Google page:\n\n🔗 ${googleReviewUrl}`);
  } 
  else if (data === 'RATING_1' || data === 'RATING_2' || data === 'RATING_3') {
    await ctx.reply('🙏 Thank you for your feedback. We apologize that your stay fell short. Our General Manager has received your notes and will reach out to resolve this.');
  }
});

/**
 * Intelligent AI Guest Concierge Handler with Structured JSON & MongoDB Auto-Routing
 */
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  const userName = ctx.from.first_name || 'Guest';
  const chatId = ctx.chat.id.toString();
  console.log(`📩 GUEST MESSAGE from ${userName} (${chatId}): "${text}"`);

  try {
    await ctx.replyWithChatAction('typing');

    // 1. Call Gemini with retry wrapper, requesting strict structured JSON
    const response = await callGeminiWithRetry([
      {
        role: 'user',
        parts: [
          {
            text: `You are the AI concierge backend for Grand Hotel in Nigeria. Analyze the guest's message and extract structured JSON.
            
            Return ONLY a valid JSON object with these keys:
            - "isOperational": boolean (true if the guest needs a physical item, maintenance, housekeeping, or front desk action like towels, AC fix, food, luggage. false if it is just an informational question like Wi-Fi password, checkout time, pool hours).
            - "category": string (must be one of: "Housekeeping", "Maintenance", "F&B", "Front Desk", "General Inquiry").
            - "roomNumber": string (extract room number if mentioned, e.g., "302", otherwise "Unassigned").
            - "reply": string (A polite, professional, warm response to send back to the guest on Telegram).

            Guest message: "${text}"`
          }
        ]
      }
    ]);

    // Clean up response text to safely parse JSON
    let rawOutput = response.text.trim();
    if (rawOutput.startsWith('```json')) {
      rawOutput = rawOutput.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (rawOutput.startsWith('```')) {
      rawOutput = rawOutput.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const aiData = JSON.parse(rawOutput);

    // 2. If it requires physical work, automatically save a TaskTicket to MongoDB Atlas
    if (aiData.isOperational) {
      await TaskTicket.create({
        guestName: userName,
        chatId: chatId,
        roomNumber: aiData.roomNumber,
        category: aiData.category,
        requestText: text,
        status: 'Pending',
        priority: aiData.category === 'Maintenance' ? 'Urgent' : 'Medium'
      });
      console.log(`✅ Operational task ticket created in MongoDB for Room ${aiData.roomNumber} [${aiData.category}]`);
    }

    // 3. Reply to the guest on Telegram
    await ctx.reply(aiData.reply);

  } catch (error) {
    console.error('Gemini Concierge Execution Error (Falling back):', error.message);
    
    // Safety Net Fallback if 503 or JSON parsing drops
    await ctx.reply(
      `🤖 Grand Hotel Front Desk: Our digital concierge is experiencing a brief high-traffic delay, but I have alerted the front desk team. A staff member will assist you shortly!`
    );
  }
});

// Start bot polling & error handling
bot.catch((err) => console.error('❌ Telegram Bot Error:', err.message));
bot.start({
  onStart: () => console.log('⚡ Telegram Service Bot is active and listening for button interactions.')
});

module.exports = {
  sendWelcomeMessage,
  sendSatisfactionCheck,
  sendPreCheckoutPrompt,
  sendReviewPrompt
};