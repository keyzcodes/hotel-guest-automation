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
const sendWelcomeMessage = async (chatId, guestName, roomNumber, booking) => {
  const hotelName = hotel.name;
  const hotelInfo = hotel.welcomeInfo;

  const text = [
    `Welcome to ${hotelName}, ${guestName}!`,
    `It’s a pleasure to have you with us.\n\nRoom ${roomNumber}${booking?.checkOutTime ? `\nCheckout: ${new Date(booking.checkOutTime).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · Lagos time` : ''}`,
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
  const text = `Settling in comfortably, ${guestName}?\n\nWe hope everything in Room ${roomNumber} is just right. How is your stay so far?`;

  const keyboard = new InlineKeyboard()
    .text("Everything’s good", `PULSE_GOOD_${roomNumber}`)
    .text("I need help", `PULSE_ISSUE_${roomNumber}`);

  return await bot.api.sendMessage(chatId, text, { reply_markup: keyboard });
};

/**
 * 3. Send 30-Minute Pre-Checkout Prompt
 */
const sendPreCheckoutPrompt = async (chatId, roomNumber, booking) => {
  const checkout = booking?.checkOutTime
    ? new Date(booking.checkOutTime).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  const minutesLeft = booking?.checkOutTime ? Math.ceil((new Date(booking.checkOutTime).getTime() - Date.now()) / 60000) : null;
  // Normal scheduling runs at the 30-minute lead. Demo offsets must not make a
  // false 30-minute claim when the booked checkout is tomorrow.
  const lead = minutesLeft !== null && minutesLeft > 0 && minutesLeft <= 30
    ? `Your checkout is in about ${minutesLeft} ${minutesLeft === 1 ? 'minute' : 'minutes'}.\n\n` : '';
  const text = `A quick checkout reminder\n\n${lead}Your checkout for Room ${roomNumber}${checkout ? ` is ${checkout} · Lagos time` : ' is approaching'}.\n\nNeed a little more time? You can request an extension below.`;

  const keyboard = new InlineKeyboard()
    .text("Ready to leave", `CHECKOUT_NOW_${roomNumber}`)
    .text("Request extension", `EXTEND_STAY_${roomNumber}`);

  return await bot.api.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: keyboard,
  });
};

/**
 * 4. Send Post-Checkout Rating & Google Review Shield
 */
const sendReviewPrompt = async (chatId, booking) => {
  if (!booking?._id) throw new Error("Review invitation requires a stay ID.");
  const googleReviewUrl = hotel.googleReviewUrl;
  const text = [
    `Thank you for staying at ${hotel.name}, ${booking.guestName}.`,
    'We’d love to hear about your stay. Your honest review helps future guests choose with confidence and helps us improve.',
    'How would you rate your stay?',
  ].join('\n\n');
  const keyboard = new InlineKeyboard();
  // The public review invitation is available regardless of the internal rating.
  if (googleReviewUrl) {
    const url = new URL(googleReviewUrl);
    if (url.protocol !== 'https:') throw new Error('Review link must use HTTPS.');
    keyboard.url('Leave a Google review ↗', googleReviewUrl).row();
  }
  for (let rating = 1; rating <= 5; rating++) {
    keyboard.text(`${rating} ★`, `RATING_${booking._id}_${rating}`);
  }

  return await bot.api.sendMessage(chatId, text, {
    reply_markup: keyboard,
  });
};

/**
 * Listen for Interactive Button Presses (Callback Queries)
 */
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  // Acknowledge the click promptly. Ignore expired clicks without running actions.
  try {
    await ctx.answerCallbackQuery();
  } catch (error) {
    const description = error.description || "";
    if (error.error_code === 400 && /query is too old|query ID is invalid|response timeout expired/i.test(description)) {
      console.warn("Expired Telegram button click skipped.");
      return;
    }
    throw error;
  }

  if (data.startsWith('RATING_')) {
    const result = await require('./guestFeedbackService').saveGuestRating(ctx);
    if (result.reply) await ctx.reply(result.reply);
    return;
  }
  await require('./stayCallbackService').runStayCallback(ctx, async (ctx) => {
  if (data.startsWith("PULSE_GOOD")) {
    await ctx.reply("😊 We are thrilled to hear that! Enjoy your stay.");
  } else if (data.startsWith("PULSE_ISSUE")) {
    await ctx.reply(
      "We’re sorry something isn’t quite right. Please tell us what needs attention.",
    );
  } else if (data.startsWith("CHECKOUT_NOW")) {
    await ctx.reply(
      "Thank you. Please visit reception to complete checkout and return your keycard.",
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
  }
  });
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
