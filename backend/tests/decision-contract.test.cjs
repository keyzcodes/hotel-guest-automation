const { test } = require('node:test');
const assert = require('node:assert/strict');
const { interpretGuestMessage, validateDecision } = require('../src/services/guestAiService');
const pending = { _id: '000000000000000000000101', category: 'F&B', requestText: 'Meal', status: 'Pending' };
const closed = { ...pending, _id: '000000000000000000000102', status: 'Resolved' };
async function contract(tickets) {
 let schema;
 await interpretGuestMessage({ text: 'Please connect me to the restaurant team', hotel: {}, booking: {}, history: [], tickets }, {
  models: { generateContent: async payload => {
   schema = payload.config.responseJsonSchema;
   return { text: JSON.stringify({ action: 'HANDOFF', category: 'F&B', ticketId: '', reply: '' }) };
  } },
 });
 return schema;
}
test('non-target actions are constrained to an empty ticket ID even when tickets exist', async () => {
 const s = await contract([pending, closed]);
 for (const action of ['ANSWER','CLARIFY','CREATE_REQUEST','HANDOFF']) {
  const branches = s.anyOf.filter(branch => branch.properties.action.enum.includes(action));
  assert.equal(branches.length, 1); assert.deepEqual(branches[0].properties.ticketId.enum, ['']);
 }
});
test('follow-up targets exclude completed work while status targets include it', async () => {
 const s = await contract([pending, closed]);
 const follow = s.anyOf.find(branch => branch.properties.action.enum.includes('FOLLOW_UP'));
 const status = s.anyOf.find(branch => branch.properties.action.enum.includes('STATUS'));
 assert.deepEqual(follow.properties.ticketId.enum, [pending._id]);
 assert.deepEqual(status.properties.ticketId.enum, [pending._id,closed._id]);
});
test('no-ticket schema omits target actions and never emits empty enums', async () => {
 const s = await contract([]); assert.equal(s.anyOf.length, 2);
 assert.equal(s.anyOf.some(branch => branch.properties.ticketId.enum.length === 0), false);
});
test('backend still rejects a non-target action carrying a ticket ID', () => {
 assert.throws(() => validateDecision({ action: 'HANDOFF', category: 'F&B', ticketId: pending._id, reply: '' }, [pending]), /Unexpected target ticket/);
});
