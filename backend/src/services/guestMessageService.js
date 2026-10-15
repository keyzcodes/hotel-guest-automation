const Message = require("../models/Message");
const Booking = require("../models/Booking");
const TaskTicket = require("../models/TaskTicket");
const hotel = require("../config/hotel");
const { interpretGuestMessage, validateDecision } = require("./guestAiService");
const { serviceFallback } = require("./guestFallbackService");

const openStatuses = ["Pending", "In Progress", "Escalated"];
async function recordAndReply(ctx, inbound, text, timing) {
  // Time persistence and Telegram separately; keep uncertain-send behaviour unchanged.
  const measure = (stage, operation) => timing ? timing.measure(stage, operation) : operation();
  // Save before sending; do not automatically retry uncertain external sends.
  const outgoing = await measure("reply_record_create", () => Message.create({
    bookingId: inbound.bookingId || null,
    channel: "TELEGRAM",
    chatId: inbound.chatId,
    direction: "OUTBOUND",
    sender: "SYSTEM",
    text,
    idempotencyKey: `AUTO:${inbound._id}`,
    processingStatus: "NOT_APPLICABLE",
    deliveryState: "PENDING",
  }));
  try {
    const sent = await measure("telegram_send", () => ctx.reply(text));
    outgoing.providerMessageId = String(sent.message_id);
    outgoing.deliveryState = "SENT";
    await measure("reply_record_confirm", () => outgoing.save());
  } catch {
    await Message.updateOne(
      { _id: outgoing._id },
      {
        $set: {
          deliveryState: "UNKNOWN",
          lastError:
            "Automatic send or reply recording could not be confirmed.",
        },
      },
    ).catch(() => {});
  }
}
async function createTicket(inbound, booking, category) {
  await TaskTicket.init();
  return TaskTicket.findOneAndUpdate(
    { sourceMessageId: inbound._id },
    {
      $setOnInsert: {
        sourceMessageId: inbound._id,
        bookingId: booking._id,
        guestName: booking.guestName,
        chatId: inbound.chatId,
        roomNumber: booking.roomNumber,
        category,
        requestText: inbound.text,
        status: "Pending",
        priority: "Medium",
      },
    },
    {
      upsert: true,
      returnDocument: "after",
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );
}
async function applyDecision(decision, inbound, booking, tickets) {
  const checked = validateDecision(decision, tickets);
  if (["ANSWER", "CLARIFY"].includes(checked.action))
    return { reply: checked.reply, needsStaff: false, ticketId: null };
  if (checked.action === "FOLLOW_UP") {
    const updated = await TaskTicket.findOneAndUpdate(
      {
        _id: checked.ticketId,
        bookingId: booking._id,
        status: { $in: openStatuses },
        "guestUpdates.messageId": { $ne: inbound._id },
      },
      {
        $push: {
          guestUpdates: {
            messageId: inbound._id,
            text: inbound.text,
            createdAt: new Date(),
          },
        },
      },
      { returnDocument: "after", runValidators: true },
    );
    if (!updated)
      return {
        reply:
          "That request may have changed. Please tell us which request you want to update.",
        needsStaff: false,
        ticketId: null,
      };
    return {
      reply:
        "Your update has been recorded on the existing request for staff review. Changes are not confirmed until staff accept them.",
      needsStaff: true,
      ticketId: updated._id,
    };
  }
  const ticket = await createTicket(inbound, booking, checked.category);
  return {
    reply: `Your ${checked.category} request for Room ${booking.roomNumber} has been recorded. Staff confirmation is pending.`,
    needsStaff: true,
    ticketId: ticket._id,
  };
}
async function processGuestMessage(ctx) {
  // Load timing only for message processing, not decision-only tests.
  const { createResponseTiming } = require("./responseTimingService");

  const chatId = String(ctx.chat.id),
    text = ctx.message.text;
  // Monotonic timings contain no guest text, phone number, chat ID, or API key.
  const timing = createResponseTiming();
  const reply = (context, message, response) => recordAndReply(context, message, response, timing);
  let inbound, booking;
  try {
    try {
      inbound = await timing.measure("inbound_save", () => Message.create({
        channel: "TELEGRAM",
        chatId,
        direction: "INBOUND",
        text,
        providerMessageId: String(ctx.message.message_id),
        idempotencyKey: `TELEGRAM:${chatId}:${ctx.message.message_id}`,
        processingStatus: "RECEIVED",
      }));
    } catch (error) {
      if (error.code === 11000) { timing.setOutcome("duplicate_ignored"); return; }
      throw error;
    }
    const linked = await timing.measure("booking_lookup", () => Booking.find({
      telegramChatId: chatId,
      stayStatus: { $in: ["ACTIVE", "EXTENDED"] },
    }).limit(2));
    if (linked.length !== 1) {
      timing.setOutcome("unlinked_stay");
      await Message.updateOne(
        { _id: inbound._id },
        { $set: { processingStatus: "NEEDS_STAFF" } },
      );
      // No active stay: keep this message unassigned and do not start AI,
      // service requests or automatic guest replies. Never reopen a past stay.
      return;
    }
    booking = linked[0];
    inbound.bookingId = booking._id;
    inbound.processingStatus = "PROCESSING";
    await timing.measure("booking_link_save", () => inbound.save());

    const replyTo = ctx.message.reply_to_message?.message_id;

    if (
      booking.extensionPromptMessageId &&
      replyTo === booking.extensionPromptMessageId
    ) {
      timing.setOutcome("extension_reply");
      // Accept a clear, limited format; reception approves the request.
      const answer = text.trim();
      const match = answer.match(
        /^(today|tomorrow|\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:,?\s+Lagos time)?[.!]?$/i,
      );

      let requestedTime = null;

      if (match) {
        const datePart = match[1].toLowerCase();
        let hour = Number(match[2]);
        const minute = Number(match[3] || 0);
        const period = match[4]?.toLowerCase();

        if (minute < 60 && (period ? hour >= 1 && hour <= 12 : hour <= 23)) {
          if (period) hour = (hour % 12) + (period === "pm" ? 12 : 0);

          const lagosNow = new Date(Date.now() + 3600000);
          if (datePart === "tomorrow") {
            lagosNow.setUTCDate(lagosNow.getUTCDate() + 1);
          }

          const day = ["today", "tomorrow"].includes(datePart)
            ? lagosNow.toISOString().slice(0, 10)
            : datePart;

          const candidate = new Date(
            `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+01:00`,
          );

          if (
            Number.isFinite(candidate.getTime()) &&
            new Date(candidate.getTime() + 3600000)
              .toISOString()
              .slice(0, 10) === day &&
            candidate > new Date() &&
            candidate > new Date(booking.checkOutTime)
          ) {
            requestedTime = candidate;
          }
        }
      }

      if (!requestedTime) {
        inbound.processingStatus = "PROCESSED";
        await inbound.save();

        await reply(
          ctx,
          inbound,
          "What checkout date and time would you prefer? Please reply to the extension question, for example: Tomorrow at 3 PM, Lagos time.",
        );
        return;
      }

      // Reuse the oldest open extension request for this stay.
      let ticket = await TaskTicket.findOne({
        bookingId: booking._id,
        category: "Front Desk",
        status: { $in: openStatuses },
        requestText: /^Stay extension requested\. Preferred checkout:/,
      }).sort({ createdAt: 1, _id: 1 });

      if (ticket) {
        ticket = await TaskTicket.findOneAndUpdate(
          {
            _id: ticket._id,
            status: { $in: openStatuses },
            "guestUpdates.messageId": { $ne: inbound._id },
          },
          {
            $push: {
              guestUpdates: {
                messageId: inbound._id,
                text: `Preferred checkout: ${answer}. Requested time: ${requestedTime.toISOString()}. Awaiting reception approval.`,
                createdAt: new Date(),
              },
            },
          },
          { returnDocument: "after", runValidators: true },
        );

        if (!ticket) throw new Error("Extension ticket changed.");
      } else {
        ticket = await createTicket(
          {
            _id: inbound._id,
            chatId: inbound.chatId,
            text: `Stay extension requested. Preferred checkout: ${answer}. Requested time: ${requestedTime.toISOString()}. Awaiting reception approval.`,
          },
          booking,
          "Front Desk",
        );
      }

      inbound.ticketId = ticket._id;
      inbound.aiAction = "HANDOFF";
      inbound.processingStatus = "NEEDS_STAFF";
      await inbound.save();

      // Keep the prompt ID so further replies use this same flow.
      await reply(
        ctx,
        inbound,
        "Thank you. We've received your preferred checkout time. We'll confirm availability shortly.",
      );
      return;
    }
    const [history, tickets] = await timing.measure("context_load", () => Promise.all([
      Message.find({
        bookingId: booking._id,
        _id: { $ne: inbound._id },
        $or: [
          { direction: "INBOUND" },
          { direction: "OUTBOUND", providerMessageId: { $ne: null } },
        ],
      })
        .select("direction text createdAt")
        .sort({ createdAt: -1, _id: -1 })
        .limit(20)
        .lean(),
      TaskTicket.find({ bookingId: booking._id, status: { $in: openStatuses } })
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean(),
    ]));
    if (text.length > 4000)
      throw new Error("Guest message exceeds AI processing limit.");
    let decision;
    try {
      decision = await timing.measure("ai_interpretation", () => interpretGuestMessage({
        text,
        hotel,
        booking,
        history: history.reverse(),
        tickets,
      }));
    } catch (error) {
      decision = serviceFallback(text, tickets);
      if (!decision) throw error;
      timing.setOutcome("local_fallback");
      console.warn("AI unavailable; local fallback used:", error.name);
    }
    const outcome = await timing.measure("decision_apply", () => applyDecision(decision, inbound, booking, tickets));
    inbound.processingStatus = outcome.needsStaff ? "NEEDS_STAFF" : "PROCESSED";
    inbound.aiAction = decision.action;
    inbound.ticketId = outcome.ticketId;
    await timing.measure("processing_result_save", () => inbound.save());
    await reply(ctx, inbound, outcome.reply);
  } catch (error) {
    timing.setOutcome("staff_handoff");
    console.error(
      "Guest message processing failed:",
      error.name,
      Number(error.status) || "",
      error.stack,
    );
    if (!inbound) {
      timing.setOutcome("inbound_save_failed");
      await ctx
        .reply(
          "We could not record your message. Please contact reception directly.",
        )
        .catch(() => {});
      return;
    }
    let handoffRecorded = Boolean(inbound.ticketId);
    if (booking && !inbound.ticketId) {
      try {
        await TaskTicket.init();

        const staffReviewKey = `STAFF_REVIEW:${booking._id}`;
        let ticket;

        try {
          ticket = await TaskTicket.findOneAndUpdate(
            { staffReviewKey },
            {
              $setOnInsert: {
                staffReviewKey,
                bookingId: booking._id,
                guestName: booking.guestName,
                chatId: inbound.chatId,
                roomNumber: booking.roomNumber,
                category: "General Inquiry",
                requestText: "Guest messages awaiting reception review.",
                status: "Pending",
                priority: "Medium",
              },
            },
            {
              upsert: true,
              returnDocument: "after",
              runValidators: true,
              setDefaultsOnInsert: true,
            },
          );
        } catch (ticketError) {
          if (ticketError.code !== 11000) throw ticketError;
          ticket = await TaskTicket.findOne({ staffReviewKey });
        }

        if (!ticket) {
          throw new Error("Staff review ticket unavailable.");
        }

        await TaskTicket.updateOne(
          {
            _id: ticket._id,
            "guestUpdates.messageId": { $ne: inbound._id },
          },
          {
            $push: {
              guestUpdates: {
                messageId: inbound._id,
                text: inbound.text,
                createdAt: inbound.createdAt || new Date(),
              },
            },
          },
          { runValidators: true },
        );

        await TaskTicket.updateOne(
          { _id: ticket._id, status: "Resolved" },
          { $set: { status: "Pending" } },
          { runValidators: true },
        );

        inbound.ticketId = ticket._id;
        handoffRecorded = true;
      } catch (reviewError) {
        console.error("Staff review save failed:", reviewError.name);
      }
    }
    await Message.updateOne(
      { _id: inbound._id },
      {
        $set: {
          processingStatus: "NEEDS_STAFF",
          aiAction: "HANDOFF",
          ticketId: inbound.ticketId || null,
          lastError: "Automatic interpretation could not finish.",
        },
      },
    ).catch(() => {});
    await reply(
      ctx,
      inbound,
      handoffRecorded
        ? "Thank you. We’ve received your request and will assist you shortly."
        : "Please contact the front desk so we can assist you.",
    ).catch(() => {});
  } finally {
    // Report every exit, including duplicates, extensions, and failed processing.
    timing.finish(inbound?._id);
  }
}
module.exports = { processGuestMessage, applyDecision };
