const { Bot, InlineKeyboard } = require("grammy");
const hotel = require("../config/hotel");
require("dotenv").config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("❌ TELEGRAM_BOT_TOKEN is missing in .env");
}

const bot = new Bot(token);

/**
 * 1. Send Check-In Welcome Message
 */
const sendWelcomeMessage = async (chatId, guestName, roomNumber) => {
  const hotelName = hotel.name;
  const hotelInfo = hotel.welcomeInfo;

  const text = [
    `Welcome to ${hotelName}, ${guestName}!`,
    `Your check-in for Room ${roomNumber} is confirmed.`,
    hotelInfo,
    "Message us here for assistance, housekeeping, or room service.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return await bot.api.sendMessage(chatId, text);
};

/**
 * 2. Send 15-Minute Satisfaction Pulse Check (Interactive Inline Buttons)
 */
const sendSatisfactionCheck = async (chatId, guestName, roomNumber) => {
  const text = `👋 Hi ${guestName}, we hope you are settling into Room ${roomNumber} smoothly!\n\nIs everything up to your expectations so far?`;

  const keyboard = new InlineKeyboard()
    .text("👍 Everything is Great", `PULSE_GOOD_${roomNumber}`)
    .text("🛠️ I Need Assistance", `PULSE_ISSUE_${roomNumber}`);

  return await bot.api.sendMessage(chatId, text, { reply_markup: keyboard });
};

/**
 * 3. Send 30-Minute Pre-Checkout Prompt
 */
const sendPreCheckoutPrompt = async (chatId, roomNumber) => {
  const text = `⏰ *Upcoming Check-Out Alert*\n\nYour check-out for Room ${roomNumber} is scheduled in 30 minutes.\nWould you like to extend your stay or prepare for check-out?`;

  const keyboard = new InlineKeyboard()
    .text("✅ Check-Out Now", `CHECKOUT_NOW_${roomNumber}`)
    .text("Request extension", `EXTEND_STAY_${roomNumber}`);

  return await bot.api.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
};

/**
 * 4. Send Post-Checkout Rating & Google Review Shield
 */
const sendReviewPrompt = async (chatId) => {
  const googleReviewUrl = hotel.googleReviewUrl;
  const text = [
    "Thank you for staying with us!",
    "How would you rate your overall experience?",
    googleReviewUrl
      ? `You are also welcome to share an honest Google review:\n${googleReviewUrl}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const keyboard = new InlineKeyboard()
    .text("1 star", "RATING_1")
    .text("2 stars", "RATING_2")
    .text("3 stars", "RATING_3")
    .text("4 stars", "RATING_4")
    .text("5 stars", "RATING_5");

  return await bot.api.sendMessage(chatId, text, {
    reply_markup: keyboard,
  });
};

/**
 * Listen for Interactive Button Presses (Callback Queries)
 */
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery(); // Stops loading spinner on mobile

  if (data.startsWith("PULSE_GOOD")) {
    await ctx.reply("😊 We are thrilled to hear that! Enjoy your stay.");
  } else if (data.startsWith("PULSE_ISSUE")) {
    await ctx.reply(
      "🚨 We apologize! Our front desk has been alerted and will attend to your room shortly. What issue are you experiencing?",
    );
  } else if (data.startsWith("CHECKOUT_NOW")) {
    await ctx.reply(
      "👍 Thank you! Please drop your keycard at the front desk when leaving.",
    );
  } else if (data.startsWith("EXTEND_STAY_")) {
    const Booking = require("../models/Booking");
    const roomNumber = data.slice("EXTEND_STAY_".length);

    const linked = await Booking.find({
      telegramChatId: String(ctx.chat.id),
      stayStatus: { $in: ["ACTIVE", "EXTENDED"] },
    }).limit(2);

    if (linked.length !== 1 || linked[0].roomNumber !== roomNumber) {
      await ctx.reply(
        "Please contact reception so we can help with the correct stay.",
      );
      return;
    }

    const prompt = await ctx.reply(
      "Of course. What date and time would you like to check out instead? Please use Lagos time.",
      { reply_markup: { force_reply: true, selective: true } },
    );

    await Booking.updateOne(
      {
        _id: linked[0]._id,
        stayStatus: { $in: ["ACTIVE", "EXTENDED"] },
      },
      { $set: { extensionPromptMessageId: prompt.message_id } },
    );
  } else if (/^RATING_[1-5]$/.test(data)) {
    await ctx.reply(
      "Thank you for your feedback. You can also tell us here what went well or what we could improve.",
    );
  }
});

/**
 * Intelligent AI Guest Concierge Handler with Structured JSON & MongoDB Auto-Routing
 */
bot.on("message:text", async (ctx) => {
  await require("./guestMessageService").processGuestMessage(ctx);
});
// Start bot polling & error handling
bot.catch((err) => console.error("❌ Telegram Bot Error:", err.message));
const startTelegramBot = () => {
  bot
    .start({
      onStart: () => console.log("Telegram bot is listening."),
    })
    .catch((error) => {
      console.error("Telegram polling stopped:", error.message);
      process.exitCode = 1;
    });
};

const sendStaffReply = (chatId, text) =>
  bot.api.sendMessage(chatId, text, {}, AbortSignal.timeout(20000));

module.exports = {
  sendWelcomeMessage,
  sendSatisfactionCheck,
  sendPreCheckoutPrompt,
  sendReviewPrompt,
  startTelegramBot,
  sendStaffReply,
};
