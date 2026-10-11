const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serviceFallback } = require('../src/services/guestFallbackService');
test('clear item requests route to Housekeeping during an AI outage', () => {
  for (const text of ['I need towels', 'Please bring a bath mat', 'Can you bring me two clean towels?', 'Please send a fresh bedsheet']) assert.equal(serviceFallback(text).category, 'Housekeeping');
  assert.equal(serviceFallback('I need towels').action, 'CREATE_REQUEST');
});
test('existing Housekeeping work asks for clarification rather than duplicating a task', () => {
  const result = serviceFallback('I need towels', [{ category: 'Housekeeping', status: 'Pending' }]);
  assert.equal(result.action, 'CLARIFY'); assert.equal(result.ticketId, '');
});
test('negation, changes, emergencies and mixed requests are not guessed', () => {
  for (const text of ['I do not need towels', 'Bring towels at 8 PM instead', 'I need towels and the AC is broken', 'Fire', 'I need to extend my stay', 'Cancel my towels', 'Where are my towels']) assert.equal(serviceFallback(text), null);
});
test('greetings still answer locally', () => assert.equal(serviceFallback('How far').action, 'ANSWER'));
