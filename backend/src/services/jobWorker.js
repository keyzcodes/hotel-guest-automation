const { randomUUID } = require("node:crypto");
const ScheduledJob = require("../models/ScheduledJob");
const Booking = require("../models/Booking");
const Message = require("../models/Message");
let running = false,
  timer;
const POLL_MS = 2000,
  LEASE_MS = 120000;
async function executeJob(job, dependencies = {}) {
  const bookings = dependencies.Booking || Booking;
  const messages = dependencies.Message || Message;
  const telegram = dependencies.telegram || require("./telegramService");
  const booking = await bookings.findById(job.bookingId);
  if (!booking)
    return { status: "CANCELLED", lastError: "Booking no longer exists." };
  const active = ["ACTIVE", "EXTENDED"].includes(booking.stayStatus);
  if (
    job.type === "REVIEW_REQUEST"
      ? booking.stayStatus !== "COMPLETED"
      : !active || new Date(booking.checkOutTime) <= new Date()
  )
    return {
      status: "CANCELLED",
      lastError: "Stay is no longer eligible for this message.",
    };
  if (job.type === "PRE_CHECKOUT") {
    const expected = `${booking._id}:PRE_CHECKOUT:${new Date(booking.checkOutTime).toISOString()}`;
    if (job.idempotencyKey !== expected)
      return {
        status: "CANCELLED",
        lastError: "Checkout time changed; reminder is obsolete.",
      };
  }
  if (!booking.telegramChatId)
    return {
      status: "PENDING",
      scheduledFor: new Date(Date.now() + 30000),
      lastError: "Waiting for a linked guest chat.",
    };
  if (job.type === "REVIEW_REQUEST") {
    const conflictingStays = await bookings
      .find({
        telegramChatId: booking.telegramChatId,
        _id: { $ne: booking._id },
        $or: [
          { stayStatus: { $in: ["ACTIVE", "EXTENDED"] } },
          {
            stayStatus: "COMPLETED",
            checkInTime: { $gte: booking.checkInTime },
          },
        ],
      })
      .select("_id")
      .limit(1);

    if (conflictingStays.length) {
      return {
        status: "CANCELLED",
        lastError:
          "A newer or active stay uses this chat; review invitation suppressed.",
      };
    }
  } else {
    const owners = await bookings
      .find({
        telegramChatId: booking.telegramChatId,
        stayStatus: { $in: ["ACTIVE", "EXTENDED"] },
      })
      .select("_id")
      .limit(2);

    if (owners.length !== 1 || String(owners[0]._id) !== String(booking._id)) {
      return {
        status: "FAILED",
        lastError: "Chat ownership is ambiguous; staff review required.",
      };
    }
  }
  const key = `JOB:${job.idempotencyKey}`;
  let outgoing = await messages.findOne({ idempotencyKey: key });
  if (outgoing)
    return {
      status: outgoing.deliveryState === "SENT" ? "COMPLETED" : "FAILED",
      lastError:
        outgoing.deliveryState === "SENT"
          ? null
          : "Previous delivery is unconfirmed. Check guest chat before resending.",
    };
  try {
    outgoing = await messages.create({
      bookingId: booking._id,
      channel: "TELEGRAM",
      chatId: booking.telegramChatId,
      direction: "OUTBOUND",
      sender: "SYSTEM",
      text: `Scheduled ${job.type} message awaiting delivery confirmation.`,
      idempotencyKey: key,
      processingStatus: "NOT_APPLICABLE",
      deliveryState: "PENDING",
    });
  } catch (error) {
    if (error.code === 11000)
      return {
        status: "FAILED",
        lastError: "Another attempt claimed this delivery. Check its result.",
      };
    throw error;
  }
  try {
    const send = async () => {
      let sent;
      if (job.type === "WELCOME")
        sent = await telegram.sendWelcomeMessage(
          booking.telegramChatId,
          booking.guestName,
          booking.roomNumber,
          booking,
        );
      else if (job.type === "PULSE_CHECK")
        sent = await telegram.sendSatisfactionCheck(
          booking.telegramChatId,
          booking.guestName,
          booking.roomNumber,
          booking,
        );
      else if (job.type === "PRE_CHECKOUT")
        sent = await telegram.sendPreCheckoutPrompt(
          booking.telegramChatId,
          booking.roomNumber,
          booking,
        );
      else if (job.type === "REVIEW_REQUEST")
        sent = await telegram.sendReviewPrompt(booking.telegramChatId, booking);
      else throw Error("Unsupported job type");
      return sent;
    };
    let deadline;
    let sent;
    try {
      sent = await Promise.race([
        send(),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(Error("Delivery timeout")), 25000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
    outgoing.text =
      sent.text || sent.caption || `Scheduled ${job.type} message sent.`;
    outgoing.providerMessageId = String(sent.message_id);
    outgoing.deliveryState = "SENT";
    await outgoing.save();
    if (job.type === "PULSE_CHECK")
      await bookings.updateOne(
        { _id: booking._id, pulseCheckStatus: "PENDING" },
        { $set: { pulseCheckStatus: "SENT" } },
      );
    return { status: "COMPLETED", lastError: null };
  } catch {
    await messages
      .updateOne(
        { _id: outgoing._id },
        {
          $set: {
            deliveryState: "UNKNOWN",
            lastError:
              "Scheduled send or delivery recording could not be confirmed.",
          },
        },
      )
      .catch(() => {});
    return {
      status: "FAILED",
      lastError: "Delivery unconfirmed. Check Telegram before sending again.",
    };
  }
}
async function tick() {
  if (running) return;
  running = true;
  try {
    for (let count = 0; count < 10; count++) {
      const now = new Date(),
        token = randomUUID();
      const job = await ScheduledJob.findOneAndUpdate(
        {
          $or: [
            { status: "PENDING", scheduledFor: { $lte: now } },
            { status: "PROCESSING", lockedUntil: { $lte: now } },
          ],
        },
        {
          $set: {
            status: "PROCESSING",
            lockToken: token,
            lockedUntil: new Date(Date.now() + LEASE_MS),
          },
          $inc: { attempts: 1 },
        },
        { sort: { scheduledFor: 1 }, returnDocument: "after" },
      );
      if (!job) break;
      let result;
      try {
        result = await executeJob(job);
      } catch (error) {
        result =
          job.attempts < 3
            ? {
                status: "PENDING",
                scheduledFor: new Date(Date.now() + 30000),
                lastError:
                  "Processing failed before confirmed delivery; retry scheduled.",
              }
            : {
                status: "FAILED",
                lastError: "Job processing failed; staff review required.",
              };
        console.error("Job processing failed:", error.name);
      }
      await ScheduledJob.updateOne(
        { _id: job._id, lockToken: token, status: "PROCESSING" },
        {
          $set: {
            ...result,
            lockedUntil: null,
            lockToken: null,
            completedAt: result.status === "COMPLETED" ? new Date() : null,
          },
        },
      );
    }
  } catch (error) {
    console.error("Job worker tick failed:", error.name);
  } finally {
    running = false;
  }
}
async function startJobWorker() {
  if (timer) return;
  await ScheduledJob.init();
  await Message.init();
  timer = setInterval(() => {
    void tick();
  }, POLL_MS);
  timer.unref();
  void tick();
  console.log("Scheduled message worker is running.");
}
function stopJobWorker() {
  clearInterval(timer);
  timer = undefined;
}
module.exports = { startJobWorker, stopJobWorker, executeJob };
