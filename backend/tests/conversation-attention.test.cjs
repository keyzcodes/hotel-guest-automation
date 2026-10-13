const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { unreadFilter, answeredFilter, acknowledgeReply, attentionLookup } = require('../src/services/conversationAttentionService');
const stamp = '2026-10-13T10:00:00.000Z';
test('read acknowledgement is scoped to the stay and explicit loaded inbound IDs', () => {
  assert.deepEqual(unreadFilter('stay-a', ['m1', 'm2']), {
    bookingId: 'stay-a', direction: 'INBOUND', staffReadAt: null, _id: { $in: ['m1', 'm2'] },
  });
  assert.equal('staffAnsweredAt' in unreadFilter('a', ['m1']), false);
});
test('pending and uncertain staff sends never acknowledge handoffs', async () => {
  for (const deliveryState of ['PENDING', 'UNKNOWN']) {
    await acknowledgeReply({ updateMany: () => { throw Error('must not clear'); } }, {
      deliveryState, bookingId: 'a', staffReplyThrough: { messageId: 'm2', createdAt: stamp },
    });
  }
});
test('confirmed staff reply covers its saved boundary, not a newer message or another stay', async () => {
  let filter, update;
  await acknowledgeReply({ updateMany: async (f, u) => { filter = f; update = u; } }, {
    deliveryState: 'SENT', bookingId: 'a', createdAt: stamp,
    staffReplyThrough: { messageId: '0002', createdAt: stamp },
  });
  const matches = message => message.bookingId === filter.bookingId && message.direction === filter.direction && !message.staffAnsweredAt &&
    (new Date(message.createdAt) < filter.$or[0].createdAt.$lt ||
      (+new Date(message.createdAt) === +filter.$or[1].createdAt && message._id <= filter.$or[1]._id.$lte));
  assert.equal(matches({ bookingId: 'a', direction: 'INBOUND', createdAt: stamp, _id: '0001' }), true);
  assert.equal(matches({ bookingId: 'a', direction: 'INBOUND', createdAt: stamp, _id: '0003' }), false);
  assert.equal(matches({ bookingId: 'b', direction: 'INBOUND', createdAt: stamp, _id: '0001' }), false);
  assert.equal(matches({ bookingId: 'a', direction: 'OUTBOUND', createdAt: stamp, _id: '0001' }), false);
  assert.equal(update.$set.staffAnsweredAt, stamp);
  // No status condition: a handoff completing interpretation after the reply stays acknowledged.
  assert.equal('processingStatus' in filter, false);
});
test('legacy replies without a saved boundary do not clear unrelated handoffs', async () => {
  await acknowledgeReply({ updateMany: () => { throw Error('must not clear'); } }, { deliveryState: 'SENT' });
});
test('attention counts require inbound staff handoffs, independently of read status', () => {
  const lookup = attentionLookup('messages').$lookup;
  assert.equal(lookup.pipeline[0].$match.direction, 'INBOUND');
  const conditions = lookup.pipeline[1].$group.needsReplyCount.$sum.$cond[0].$and;
  assert.deepEqual(conditions[0], { $eq: ['$processingStatus', 'NEEDS_STAFF'] });
  assert.deepEqual(conditions[1], { $eq: ['$aiAction', 'HANDOFF'] });
  assert.equal(JSON.stringify(conditions).includes('staffReadAt'), false);
});
function routes({ exists = true } = {}) {
  const handlers = new Map(); let mutation;
  const router = { get: (p, fn) => handlers.set('GET '+p, fn), post: (p, fn) => handlers.set('POST '+p, fn) };
  const module = { exports: {} };
  const Booking = { exists: async () => exists };
  const Message = { updateMany: async (f,u) => { mutation = { f,u }; return { modifiedCount: 1 }; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/routes/conversationRoutes.js'),'utf8'), {
    module, console, Date,
    require: name => name === 'express' ? { Router: () => router } : name === 'mongoose' ? { isObjectIdOrHexString: id => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id) } : name.endsWith('/Booking') ? Booking : name.endsWith('/Message') ? Message : name.endsWith('/conversationAttentionService') ? { unreadFilter, answeredFilter, acknowledgeReply, attentionLookup } : {},
  });
  const call = async body => { const response={ code:200, status(code){this.code=code;return this;}, json(data){this.data=data;return this;} };await handlers.get('POST /:bookingId/read')({params:{bookingId:'a'.repeat(24)},body},response);return response; };
  return { call, mutation:()=>mutation };
}
test('read route rejects invalid IDs and absent stays without writes', async () => {
  const invalid = routes();assert.equal((await invalid.call({messageIds:['bad']})).code,400);assert.equal(invalid.mutation(),undefined);
  const missing = routes({exists:false});assert.equal((await missing.call({messageIds:['b'.repeat(24)]})).code,404);assert.equal(missing.mutation(),undefined);
});
test('read route marks only supplied messages and never clears Needs reply', async () => {
  const f=routes();const result=await f.call({messageIds:['b'.repeat(24)]});assert.equal(result.data.readCount,1);
  assert.deepEqual(f.mutation().f,unreadFilter('a'.repeat(24),['b'.repeat(24)]));assert.deepEqual(Object.keys(f.mutation().u.$set),['staffReadAt']);
});
