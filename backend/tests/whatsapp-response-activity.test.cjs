const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: flush } = require('node:timers/promises');
const { startResponseActivity } = require('../src/services/whatsappResponseActivity');

test('a fast reply clears typing and stops refreshes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const presence = [];
  const activity = startResponseActivity({
    setTyping: async value => presence.push(value),
  });
  await flush();
  await activity.finish();
  await flush();
  t.mock.timers.tick(30000);
  await flush();
  assert.deepEqual(presence, [true, false]);
});

test('a long reply refreshes typing until completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const presence = [];
  const activity = startResponseActivity({
    setTyping: async value => presence.push(value),
  });
  await flush();
  t.mock.timers.tick(5000);
  await flush();
  t.mock.timers.tick(15000);
  await flush();
  await activity.finish();
  await flush();
  assert.ok(presence.filter(Boolean).length > 1);
  assert.equal(presence.at(-1), false);
  const count = presence.length;
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(presence.length, count);
});

test('disconnect cancels typing refreshes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const controller = new AbortController();
  const presence = [];
  const activity = startResponseActivity({
    signal: controller.signal, setTyping: async value => presence.push(value),
  });
  await flush();
  controller.abort();
  await flush();
  t.mock.timers.tick(30000);
  await activity.finish();
  assert.deepEqual(presence, [true, false]);
});

test('presence failures still allow completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.mock.method(console, 'warn', () => {});
  const activity = startResponseActivity({
    setTyping: async () => { throw Error('Synthetic presence failure'); },
  });
  t.mock.timers.tick(5000);
  await flush();
  await activity.finish();
  await flush();
});
