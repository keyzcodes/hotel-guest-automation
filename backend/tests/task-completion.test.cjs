const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function fixture(category = "Housekeeping", failure = false) {
  let record,
    sends = 0;
  const ticket = {
    _id: "task1",
    bookingId: "stay1",
    category,
    requestText: "Please bring a bath mat",
    status: "Pending",
  };
  const booking = {
    _id: "stay1",
    stayStatus: "ACTIVE",
    telegramChatId: "chat1",
  };
  const dependencies = {
    "../models/TaskTicket": {
      findById: async () => ticket,
      findByIdAndUpdate: async () => {
        ticket.status = "Resolved";
        return ticket;
      },
    },
    "../models/Booking": {
      findById: async () => booking,
      find: () => ({ select: () => ({ limit: async () => [booking] }) }),
    },
    "../models/Message": {
      findOne: async () => record,
      create: async (value) => {
        record = { ...value, _id: "message1", save: async () => {} };
        return record;
      },
      updateOne: async () => {},
    },
    "./telegramService": {
      sendStaffReply: async () => {
        sends++;
        if (failure) throw Error("provider failure");
        return { message_id: 1 };
      },
    },
  };
  const context = {
    require: (name) => dependencies[name],
    module: { exports: {} },
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../src/services/taskCompletionService.js"),
      "utf8",
    ),
    context,
  );
  return {
    run: context.module.exports.completeTask,
    ticket,
    sends: () => sends,
    message: () => record,
  };
}
test("one action resolves and sends a saved confirmation; repeated action does not resend", async () => {
  const f = fixture();
  const result = await f.run("task1");
  assert.equal(result.notificationState, "SENT");
  assert.equal(f.ticket.status, "Resolved");
  assert.equal(f.message().idempotencyKey, "TASK_DONE:task1");
  await f.run("task1");
  assert.equal(f.sends(), 1);
});
test("Front Desk decision is not silently approved or notified as complete", async () => {
  const f = fixture("Front Desk");
  assert.equal((await f.run("task1")).code, 409);
  assert.equal(f.ticket.status, "Pending");
  assert.equal(f.sends(), 0);
});
test("uncertain delivery keeps task complete and does not resend on retry", async () => {
  const f = fixture("Housekeeping", true);
  assert.equal((await f.run("task1")).notificationState, "UNKNOWN");
  assert.equal(f.ticket.status, "Resolved");
  await f.run("task1");
  assert.equal(f.sends(), 1);
});
