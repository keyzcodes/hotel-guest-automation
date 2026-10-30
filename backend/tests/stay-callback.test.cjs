const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function fixture({
  active = true,
  foreign = false,
  duplicate = false,
  failSend = false,
  ambiguous = false,
} = {}) {
  const records = [],
    updates = [];
  let sends = 0,
    handled = 0;
  const booking = {
    _id: "stay",
    roomNumber: "101",
    checkOutTime: "2026-10-16T11:00:00Z",
  };
  const Message = {
    findOne: async () => ({
      bookingId: "stay",
      idempotencyKey: foreign
        ? "JOB:older:PULSE_CHECK"
        : "JOB:stay:PULSE_CHECK",
    }),
    create: async (data) => {
      if (duplicate) throw Object.assign(Error("duplicate"), { code: 11000 });
      const row = { ...data, _id: records.length, save: async () => {} };
      records.push(row);
      return row;
    },
    updateOne: async (...args) => updates.push(args),
  };
  const Booking = {
    findOne: async (query) => {
      assert.equal(query._id, "stay");
      assert.ok(query.stayStatus.$in.includes("ACTIVE"));
      return active ? booking : null;
    },
    find: () => ({
      select: () => ({
        limit: async () =>
          ambiguous ? [booking, { _id: "other" }] : [booking],
      }),
    }),
    updateOne: async (...args) => updates.push(args),
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../src/services/stayCallbackService.js"),
      "utf8",
    ),
    {
      module,
      Date,
      require: (n) => (n.includes("Booking") ? Booking : Message),
    },
  );
  const ctx = {
    chat: { id: 42, type: "private" },
    from: { id: 42 },
    callbackQuery: {
      id: "query",
      data: "PULSE_GOOD_101",
      message: { message_id: 9 },
    },
    reply: async () => {
      sends++;
      if (failSend) throw Error("provider");
      return { message_id: 10 };
    },
  };
  return {
    ctx,
    records,
    updates,
    run: () =>
      module.exports.runStayCallback(ctx, async (wrapped) => {
        handled++;
        await wrapped.reply("Enjoy your stay.");
      }),
    sends: () => sends,
    handled: () => handled,
  };
}
test("closed stay buttons stay silent and create no action or reply", async () => {
  const f = fixture({ active: false });
  await f.run();
  assert.equal(f.handled(), 0);
  assert.equal(f.sends(), 0);
  assert.equal(f.records.length, 0);
});
test("prompt from another stay is rejected even for the same room", async () => {
  const f = fixture({ foreign: true });
  await f.run();
  assert.equal(f.handled(), 0);
});
test("ambiguous active chat cannot run a button action", async () => {
  const f = fixture({ ambiguous: true });
  await f.run();
  assert.equal(f.handled(), 0);
});
test("accepted pulse records inbound choice, satisfaction and confirmed outbound", async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.sends(), 1);
  assert.equal(f.records[0].bookingId, "stay");
  assert.equal(f.records[0].direction, "INBOUND");
  assert.equal(f.records[1].deliveryState, "SENT");
  assert.ok(
    f.updates.some((args) => args[1].$set.pulseCheckStatus === "ALL_GOOD"),
  );
});
test("replayed callback id does not repeat actions or sends", async () => {
  const f = fixture({ duplicate: true });
  await f.run();
  assert.equal(f.handled(), 0);
  assert.equal(f.sends(), 0);
});
test("uncertain send is marked unknown and no automatic resend occurs", async () => {
  const f = fixture({ failSend: true });
  await assert.rejects(f.run(), /provider/);
  assert.equal(f.sends(), 1);
  assert.ok(f.updates.some((args) => args[1].$set.deliveryState === "UNKNOWN"));
});
test("unknown and group callbacks stay silent", async () => {
  const f = fixture();
  f.ctx.chat.type = "group";
  await f.run();
  assert.equal(f.handled(), 0);
});
