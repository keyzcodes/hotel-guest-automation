const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function fixture({
  linked = true,
  status = "ACTIVE",
  existing,
  fail = false,
  expired = false,
  otherStays = [],
} = {}) {
  let sends = 0,
    record = existing;
  const booking = {
    _id: "stay",
    stayStatus: status,
    guestName: "Guest",
    roomNumber: "101",
    telegramChatId: linked ? "chat" : null,
    checkInTime: new Date("2026-10-13T09:00:00Z"),
    checkOutTime: new Date(Date.now() + (expired ? -1000 : 600000)),
  };
  const Booking = {
    findById: async () => booking,
    find: (query) => ({
      select: () => ({
        limit: async (limit) => {
          const stays = [booking, ...otherStays];
          return stays
            .filter((stay) => {
              if (stay.telegramChatId !== query.telegramChatId) return false;

              if (query.$or) {
                if (String(stay._id) === String(query._id.$ne)) return false;
                return (
                  ["ACTIVE", "EXTENDED"].includes(stay.stayStatus) ||
                  (stay.stayStatus === "COMPLETED" &&
                    new Date(stay.checkInTime) >=
                      new Date(query.$or[1].checkInTime.$gte))
                );
              }

              return query.stayStatus.$in.includes(stay.stayStatus);
            })
            .slice(0, limit);
        },
      }),
    }),
    updateOne: async () => {},
  };
  const Message = {
    findOne: async () => record,
    create: async (data) => {
      record = { ...data, _id: "msg", save: async () => {} };
      return record;
    },
    updateOne: async () => {},
  };
  const send = async () => {
    sends++;
    if (fail) throw Error("provider");
    return { message_id: 123, text: "Welcome guest" };
  };
  const telegram = {
    sendWelcomeMessage: send,
    sendSatisfactionCheck: send,
    sendPreCheckoutPrompt: send,
    sendReviewPrompt: send,
  };
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../src/services/jobWorker.js"),
      "utf8",
    ),
    {
      module,
      require: (name) => (name === "node:crypto" ? require(name) : {}),
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
    },
  );
  return {
    run: (job = {}) =>
      module.exports.executeJob(
        {
          type: "WELCOME",
          bookingId: "stay",
          idempotencyKey: "stay:WELCOME",
          ...job,
        },
        { Booking, Message, telegram },
      ),
    sends: () => sends,
    record: () => record,
  };
}
test("welcome saved and sent; repeated processing does not resend", async () => {
  const f = fixture();
  assert.equal((await f.run()).status, "COMPLETED");
  await f.run();
  assert.equal(f.sends(), 1);
  assert.equal(f.record().deliveryState, "SENT");
});
test("unlinked stay waits without sending", async () => {
  const f = fixture({ linked: false });
  assert.equal((await f.run()).status, "PENDING");
  assert.equal(f.sends(), 0);
});
test("expired or closed stay cancels check-in messages", async () => {
  for (const options of [{ expired: true }, { status: "COMPLETED" }]) {
    const f = fixture(options);
    assert.equal((await f.run()).status, "CANCELLED");
    assert.equal(f.sends(), 0);
  }
});
test("review requires confirmed checkout", async () => {
  assert.equal(
    (await fixture().run({ type: "REVIEW_REQUEST" })).status,
    "CANCELLED",
  );
  assert.equal(
    (await fixture({ status: "COMPLETED" }).run({ type: "REVIEW_REQUEST" }))
      .status,
    "COMPLETED",
  );
});
test("uncertain send fails and is not automatically resent", async () => {
  const f = fixture({ fail: true });
  assert.equal((await f.run()).status, "FAILED");
  await f.run();
  assert.equal(f.sends(), 1);
});
test("obsolete checkout reminder is cancelled", async () => {
  const f = fixture();
  assert.equal(
    (await f.run({ type: "PRE_CHECKOUT", idempotencyKey: "old-time" })).status,
    "CANCELLED",
  );
  assert.equal(f.sends(), 0);
});
test("older completed stay does not block feedback", async () => {
  const f = fixture({
    status: "COMPLETED",
    otherStays: [
      {
        _id: "older-stay",
        telegramChatId: "chat",
        stayStatus: "COMPLETED",
        checkInTime: new Date("2026-10-12T09:00:00Z"),
      },
    ],
  });

  assert.equal((await f.run({ type: "REVIEW_REQUEST" })).status, "COMPLETED");
  assert.equal(f.sends(), 1);
});

test("active or newer completed stay blocks outdated feedback", async () => {
  for (const status of ["ACTIVE", "EXTENDED", "COMPLETED"]) {
    const f = fixture({
      status: "COMPLETED",
      otherStays: [
        {
          _id: "newer-stay",
          telegramChatId: "chat",
          stayStatus: status,
          checkInTime: new Date("2026-10-14T09:00:00Z"),
        },
      ],
    });

    assert.equal((await f.run({ type: "REVIEW_REQUEST" })).status, "CANCELLED");
    assert.equal(f.sends(), 0);
  }
});
