"use strict";
const { randomUUID } = require("node:crypto");
const PREFIX = "WA1:";
const active = (b) =>
  b && ["ACTIVE", "EXTENDED"].includes(b.stayStatus) && !b.confirmedCheckoutAt;
function createService(deps = {}) {
  const jobs = deps.jobs || require("../models/ScheduledJob");
  const bookings = deps.bookings || require("../models/Booking");
  const messages = deps.messages || require("../models/Message");
  const transport = deps.transport || require("./whatsappService");
  const now = deps.now || (() => new Date());
  let timer,
    running,
    stopping = false;
  const enabled = () =>
    deps.enabled
      ? deps.enabled()
      : process.env.GUEST_CHANNEL === "WHATSAPP" &&
        process.env.WHATSAPP_STAY_MESSAGES_ENABLED === "true";
  const keyFor = (b, type) =>
    `${PREFIX}${b._id}:${type}${type === "PRE_CHECKOUT" ? ":" + new Date(b.checkOutTime).toISOString() : ""}`;
  function eligible(b, job) {
    if (!active(b) || new Date(b.checkOutTime) <= now()) return false;
    if (!["WELCOME", "PRE_CHECKOUT"].includes(job.type)) return false;
    return job.idempotencyKey === keyFor(b, job.type);
  }
  async function schedule(booking) {
    if (!enabled() || !active(booking)) return false;
    const departure = new Date(booking.checkOutTime),
      arrival = new Date(booking.checkInTime);
    if (
      !Number.isFinite(departure.getTime()) ||
      !Number.isFinite(arrival.getTime()) ||
      departure <= arrival
    )
      throw Error("Invalid stay times.");
    for (const [type, scheduledFor] of [
      ["WELCOME", arrival],
      [
        "PRE_CHECKOUT",
        new Date(
          process.env.JOB_DEMO_MODE === "true"
            ? arrival.getTime() + 2 * 60000
            : Math.max(arrival.getTime(), departure.getTime() - 30 * 60000),
        ),
      ],
    ]) {
      await jobs.updateOne(
        { idempotencyKey: keyFor(booking, type) },
        {
          $setOnInsert: {
            bookingId: booking._id,
            type,
            scheduledFor,
            idempotencyKey: keyFor(booking, type),
            status: "PENDING",
          },
        },
        { upsert: true, runValidators: true },
      );
    }
    return true;
  }
  async function execute(job) {
    if (!enabled() || stopping)
      return { status: "PENDING", scheduledFor: new Date(+now() + 30000) };
    let booking = await bookings.findById(job.bookingId);
    if (!eligible(booking, job))
      return {
        status: "CANCELLED",
        lastError: "Stay ended or message is obsolete.",
      };
    const jid = booking.whatsappJid;
    if (!/^[1-9]\d{7,14}@s\.whatsapp\.net$/.test(jid || ""))
      return {
        status: "FAILED",
        lastError: "Guest needs a verified WhatsApp address.",
      };
    const owners = await bookings
      .find({ whatsappJid: jid, stayStatus: { $in: ["ACTIVE", "EXTENDED"] } })
      .select("_id")
      .limit(2);
    if (owners.length !== 1 || String(owners[0]._id) !== String(booking._id))
      return {
        status: "FAILED",
        lastError: "Guest matching needs staff review.",
      };
    if (!transport.isConnected())
      return {
        status: "PENDING",
        scheduledFor: new Date(+now() + 30000),
        lastError: "Waiting for WhatsApp connection; no send attempted.",
      };
    const key = `JOB:${job.idempotencyKey}`;
    let outgoing = await messages.findOne({ idempotencyKey: key });
    if (outgoing)
      return {
        status: outgoing.deliveryState === "SENT" ? "COMPLETED" : "FAILED",
        lastError:
          outgoing.deliveryState === "SENT"
            ? null
            : "Earlier send unconfirmed. Check WhatsApp before resending.",
      };
    const text =
      job.type === "WELCOME"
        ? `Welcome, ${booking.guestName}. You are checked into Room ${booking.roomNumber}. Message this number if you need assistance during your stay.`
        : `Hello ${booking.guestName}, your planned checkout for Room ${booking.roomNumber} is ${new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" }).format(new Date(booking.checkOutTime))} (Lagos time). Please contact reception if you would like to extend. Reception will confirm your departure.`;
    try {
      outgoing = await messages.create({
        bookingId: booking._id,
        channel: "WHATSAPP",
        chatId: jid,
        direction: "OUTBOUND",
        sender: "SYSTEM",
        text,
        idempotencyKey: key,
        processingStatus: "NOT_APPLICABLE",
        deliveryState: "PENDING",
      });
    } catch (e) {
      if (e.code === 11000)
        return {
          status: "FAILED",
          lastError: "Another attempt already claimed this message.",
        };
      throw e;
    }
    // Refresh immediately before sending. A provider send and checkout are not one atomic operation.
    try {
      booking = await bookings.findById(job.bookingId);
      if (
        stopping ||
        !enabled() ||
        !eligible(booking, job) ||
        booking.whatsappJid !== jid
      ) {
        await messages.updateOne(
          { _id: outgoing._id },
          {
            $set: {
              deliveryState: "NOT_TRACKED",
              lastError:
                "Cancelled before send: stay or messaging state changed.",
            },
          },
        );
        return { status: "CANCELLED", lastError: "State changed before send." };
      }
      let timeout;
      let sent;
      try {
        sent = await Promise.race([
          transport.sendStaffReply(jid, text),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Error("Send timeout")), 25000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      if (!sent?.message_id) throw Error("No provider message ID.");
      outgoing.providerMessageId = String(sent.message_id);
      outgoing.deliveryState = "SENT";
      await outgoing.save();
      return { status: "COMPLETED", lastError: null };
    } catch {
      await messages
        .updateOne(
          { _id: outgoing._id },
          {
            $set: {
              deliveryState: "UNKNOWN",
              lastError:
                "Submission or saving its result was unconfirmed. Do not automatically resend.",
            },
          },
        )
        .catch(() => {});
      return {
        status: "FAILED",
        lastError: "Delivery unconfirmed. Check WhatsApp before resending.",
      };
    }
  }
  async function tick() {
    if (!enabled() || stopping) return;
    for (let count = 0; count < 10 && !stopping; count++) {
      const token = randomUUID();
      const job = await jobs.findOneAndUpdate(
        {
          idempotencyKey: { $regex: "^WA1:" },
          $or: [
            { status: "PENDING", scheduledFor: { $lte: now() } },
            { status: "PROCESSING", lockedUntil: { $lte: now() } },
          ],
        },
        {
          $set: {
            status: "PROCESSING",
            lockToken: token,
            lockedUntil: new Date(+now() + 120000),
          },
          $inc: { attempts: 1 },
        },
        { sort: { scheduledFor: 1 }, returnDocument: "after" },
      );
      if (!job) break;
      let result;
      try {
        result = await execute(job);
      } catch {
        result =
          job.attempts < 3
            ? {
                status: "PENDING",
                scheduledFor: new Date(+now() + 30000),
                lastError: "Processing failed; retry scheduled.",
              }
            : { status: "FAILED", lastError: "Processing needs staff review." };
      }
      await jobs.updateOne(
        { _id: job._id, lockToken: token, status: "PROCESSING" },
        {
          $set: {
            ...result,
            lockToken: null,
            lockedUntil: null,
            completedAt: result.status === "COMPLETED" ? now() : null,
          },
        },
      );
    }
  }
  function launchTick() {
    if (running) return;
    running = tick()
      .catch((e) => console.error("WhatsApp stay worker failed:", e.name))
      .finally(() => {
        running = null;
      });
  }
  async function start() {
    if (timer || !enabled()) return;
    await jobs.init();
    await messages.init();
    stopping = false;
    timer = setInterval(launchTick, 2000);
    timer.unref();
    launchTick();
    console.log(
      "WhatsApp welcome and checkout reminders enabled for new check-ins.",
    );
  }
  async function stop() {
    stopping = true;
    clearInterval(timer);
    timer = null;
    if (running) await running;
  }
  return { schedule, execute, start, stop };
}
let singleton;
const service = () => (singleton ||= createService());
module.exports = {
  createService,
  schedule: (b) => service().schedule(b),
  start: () => service().start(),
  stop: () => (singleton ? singleton.stop() : Promise.resolve()),
};
