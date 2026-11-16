const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createService} = require('../src/services/whatsappStayMessages');
function fixture(options = {}) {
  const now = new Date('2026-11-06T12:00:00Z');
  const booking = {_id: 'stay1', guestName: 'Test Guest', roomNumber: '203', whatsappJid: '2348012345678@s.whatsapp.net', stayStatus: 'ACTIVE', checkInTime: new Date(+now - 10000), checkOutTime: new Date(+now + 3600000), ...options.booking};
  const record = {value: options.existing}; let sends = 0, reads = 0; const savedJobs = new Map();
  const jobs = {updateOne: async (q,u) => {if (!savedJobs.has(q.idempotencyKey)) savedJobs.set(q.idempotencyKey, u.$setOnInsert);}};
  const bookings = {findById: async () => {reads++; return options.changeBeforeSend && reads > 1 ? {...booking, stayStatus: 'COMPLETED'} : booking;}, find: () => ({select: () => ({limit: async () => options.ambiguous ? [{_id:'stay1'}, {_id:'stay2'}] : [{_id:'stay1'}]})})};
  const messages = {findOne: async () => record.value, create: async data => {if (options.collision) throw Object.assign(Error(),{code:11000}); record.value = {...data, _id:'msg1', save: async () => {if (options.saveFailure) throw Error('database');}}; return record.value;}, updateOne: async (q,u) => Object.assign(record.value,u.$set)};
  const transport = {isConnected: () => !options.disconnected, sendStaffReply: async (jid,text) => {sends++; if (options.sendFailure) throw Error('provider'); return {message_id: options.noId ? null : 'wa-1', text};}};
  const service = createService({hotel: {name: 'Ambassador Hotel'},jobs,bookings,messages,transport,now: () => now,enabled: () => options.enabled !== false});
  const job = {bookingId:'stay1', type:'WELCOME', idempotencyKey:'WA1:stay1:WELCOME'};
  return {service,booking,job,record,savedJobs,sends:()=>sends};
}
test('new scheduling is idempotent and creates welcome, settling-in and checkout jobs',async()=>{const f=fixture();await f.service.schedule(f.booking);await f.service.schedule(f.booking);assert.equal(f.savedJobs.size,3);assert.deepEqual([...f.savedJobs.values()].map(j=>j.type),['WELCOME','PULSE_CHECK','PRE_CHECKOUT']);});
test('welcome saves correct channel, guest and actual text; replay does not resend',async()=>{const f=fixture();assert.equal((await f.service.execute(f.job)).status,'COMPLETED');await f.service.execute(f.job);assert.equal(f.sends(),1);assert.equal(f.record.value.channel,'WHATSAPP');assert.equal(f.record.value.deliveryState,'SENT');assert.match(f.record.value.text,/Room 203/);assert.match(f.record.value.text,/Welcome to Ambassador Hotel/);assert.match(f.record.value.text,/Powered by Sesora/);assert.equal(f.record.value.providerMessageId,'wa-1');});
test('disconnected transport waits without claiming an outbound send',async()=>{const f=fixture({disconnected:true});assert.equal((await f.service.execute(f.job)).status,'PENDING');assert.equal(f.record.value,undefined);assert.equal(f.sends(),0);});
test('ended, cancelled, overdue and confirmed stays do not send',async()=>{for(const booking of [{stayStatus:'COMPLETED'},{stayStatus:'CANCELLED'},{checkOutTime:new Date('2026-11-06T11:00:00Z')},{confirmedCheckoutAt:new Date()}]){const f=fixture({booking});assert.equal((await f.service.execute(f.job)).status,'CANCELLED');assert.equal(f.sends(),0);}});
test('obsolete checkout reminder does not send',async()=>{const f=fixture();assert.equal((await f.service.execute({...f.job,type:'PRE_CHECKOUT',idempotencyKey:'WA1:stay1:PRE_CHECKOUT:old'})).status,'CANCELLED');assert.equal(f.sends(),0);});
test('current branded reminder uses the saved checkout time in WAT',async()=>{const f=fixture();const key='WA1:stay1:PRE_CHECKOUT:'+f.booking.checkOutTime.toISOString();assert.equal((await f.service.execute({...f.job,type:'PRE_CHECKOUT',idempotencyKey:key})).status,'COMPLETED');assert.match(f.record.value.text,/2:00 pm/);assert.match(f.record.value.text,/Ambassador Hotel/);assert.match(f.record.value.text,/Powered by Sesora/);assert.match(f.record.value.text,/WAT/);assert.doesNotMatch(f.record.value.text,/checkout.*complete/i);});
test('ambiguous identity fails without a send',async()=>{const f=fixture({ambiguous:true});assert.equal((await f.service.execute(f.job)).status,'FAILED');assert.equal(f.sends(),0);});
test('checkout between claim and send cancels send',async()=>{const f=fixture({changeBeforeSend:true});assert.equal((await f.service.execute(f.job)).status,'CANCELLED');assert.equal(f.sends(),0);assert.equal(f.record.value.deliveryState,'NOT_TRACKED');});
test('provider failure, missing ID and failed confirmation save do not automatically resend',async()=>{for(const options of [{sendFailure:true},{noId:true},{saveFailure:true}]){const f=fixture(options);assert.equal((await f.service.execute(f.job)).status,'FAILED');assert.equal(f.record.value.deliveryState,'UNKNOWN');await f.service.execute(f.job);assert.equal(f.sends(),1);}});
test('concurrent claim collision does not send',async()=>{const f=fixture({collision:true});assert.equal((await f.service.execute(f.job)).status,'FAILED');assert.equal(f.sends(),0);});
test('disabled feature schedules and sends nothing',async()=>{const f=fixture({enabled:false});assert.equal(await f.service.schedule(f.booking),false);assert.equal(f.savedJobs.size,0);assert.equal((await f.service.execute(f.job)).status,'PENDING');assert.equal(f.sends(),0);});
test('unsupported review jobs are not sent',async()=>{for(const type of ['REVIEW_REQUEST']){const f=fixture();assert.equal((await f.service.execute({...f.job,type})).status,'CANCELLED');assert.equal(f.sends(),0);}});

test('noon reminder renders the recorded date and 12 noon', async () => {
  const f = fixture({booking: {checkOutTime: new Date('2026-11-07T11:00:00Z')}});
  const key = 'WA1:stay1:PRE_CHECKOUT:' + f.booking.checkOutTime.toISOString();
  await f.service.execute({...f.job, type: 'PRE_CHECKOUT', idempotencyKey: key});
  assert.match(f.record.value.text, /7 November 2026 at 12 noon/);
});

test('demo uses one-minute settling-in and two-minute checkout offsets; normal timing stays separate', async () => {
  const previous = process.env.JOB_DEMO_MODE;
  try {
    for (const demo of [true, false]) {
      process.env.JOB_DEMO_MODE = String(demo);
      const f = fixture();
      await f.service.schedule(f.booking);
      const jobs = [...f.savedJobs.values()];
      const pulse = jobs.find(job => job.type === 'PULSE_CHECK');
      const reminder = jobs.find(job => job.type === 'PRE_CHECKOUT');
      assert.equal(+pulse.scheduledFor - +f.booking.checkInTime, (demo ? 1 : 15) * 60000);
      assert.equal(+reminder.scheduledFor, demo ? +f.booking.checkInTime + 120000 : +f.booking.checkOutTime - 1800000);
    }
  } finally { if (previous === undefined) delete process.env.JOB_DEMO_MODE; else process.env.JOB_DEMO_MODE = previous; }
});
test('short stay has no settling-in job after its departure', async () => {
  const f = fixture({booking: {checkOutTime: new Date('2026-11-06T12:00:20Z')}});
  await f.service.schedule(f.booking);
  assert.equal([...f.savedJobs.values()].some(job => job.type === 'PULSE_CHECK'), false);
});
test('settling-in uses the saved stay and branding, is idempotent and cancels after checkout', async () => {
  const f = fixture(); const job = {...f.job, type: 'PULSE_CHECK', idempotencyKey:'WA1:stay1:PULSE_CHECK'};
  assert.equal((await f.service.execute(job)).status,'COMPLETED');
  assert.match(f.record.value.text, /settling comfortably into Room 203/);
  assert.match(f.record.value.text, /Is everything in your room as you expected/);
  assert.match(f.record.value.text, /Ambassador Hotel · Guest Services/);
  await f.service.execute(job); assert.equal(f.sends(),1);
  const ended = fixture({booking: {stayStatus:'COMPLETED'}});
  assert.equal((await ended.service.execute(job)).status,'CANCELLED'); assert.equal(ended.sends(),0);
  const changed = fixture({changeBeforeSend:true});
  assert.equal((await changed.service.execute(job)).status,'CANCELLED'); assert.equal(changed.sends(),0);
});
