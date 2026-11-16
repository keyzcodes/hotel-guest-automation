const { test } = require('node:test');
const assert = require('node:assert/strict');
const { completionText } = require('../src/services/taskCompletionText');
const booking = {guestName:'Sunday Jime'};
test('completed towel delivery gets a short personalised outcome, not quoted ticket text', () => {
  const text = completionText({category:'Housekeeping',requestText:'Please bring two towels to my room.'}, booking);
  assert.match(text,/Hello Sunday, your towels have been delivered\./);
  assert.doesNotMatch(text,/Please bring|marked|resolved|Sunday Jime/);
  assert.match(text,/Guest Services/);
  assert.match(completionText({category:'Housekeeping',requestText:'Please bring one towel.'},{guestName:'sunday jime'}),/Hello Sunday, your towel has been delivered/);
});
test('complaints, compound requests, repairs and unknown services never acquire invented delivery facts', () => {
  for (const [category, requestText] of [
    ['Housekeeping','My towels were not delivered'],
    ['Housekeeping','Please bring two towels and repair the light.'],
    ['Maintenance','Please bring two towels.'],
    ['Maintenance','My air conditioner is broken.'],
  ]) {
    const text = completionText({category,requestText}, booking);
    assert.match(text,/our team has completed your request/);
    assert.doesNotMatch(text,/delivered|repaired|air conditioner|broken|not delivered/);
  }
});
