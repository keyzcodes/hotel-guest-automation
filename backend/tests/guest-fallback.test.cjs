const { test } = require("node:test");
const assert = require("node:assert/strict");
const { greetingFallback } = require("../src/services/guestFallbackService");
test("clear greetings and thanks get a local answer without a ticket action", () => {
  for (const text of [
    "Hi",
    "How far",
    "  How are you doing? ",
    "Good evening!",
    "Thank you",
  ]) {
    const reply = greetingFallback(text);
    assert.equal(reply.action, "ANSWER");
    assert.equal(reply.ticketId, "");
    assert.ok(reply.reply);
  }
});
test("requests, mixed messages, ambiguous replies and emergencies are never treated as greetings", () => {
  for (const text of [
    "Hi, I need towels",
    "How far with my towels",
    "Thanks but the AC is broken",
    "Can I extend my stay",
    "Help",
    "Fire",
    "Not now",
    "Jskssksixkxjx",
    "Yes",
    "",
  ])
    assert.equal(greetingFallback(text), null);
});
