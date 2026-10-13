const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture({ category='General Inquiry', answered=true, status='Pending', changed=false, handoff=false, exists=true }={}) {
  let writes=0, filter;
  const ticket={_id:'ticket',bookingId:'stay',category,status,sourceMessageId:'source',guestUpdates:[{messageId:'update'}],updatedAt:new Date()};
  const TaskTicket={findById:async()=>exists?ticket:null,findOneAndUpdate:async(f,u)=>{writes++;filter=f;return changed?null:{...ticket,status:u.$set.status}}};
  const Message={exists:async query=>query.aiAction?handoff:query.staffAnsweredAt===null?!answered:true};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/services/taskReviewService.js'),'utf8'),{module,require:name=>name.endsWith('TaskTicket')?TaskTicket:Message});
  return { run:()=>module.exports.closeReview('ticket'), writes:()=>writes, filter:()=>filter, service:module.exports, ticket };
}
test('unanswered reception review cannot close',async()=>{const f=fixture({answered:false});assert.equal((await f.run()).code,409);assert.equal(f.writes(),0)});
test('answered review closes without any message send or booking action',async()=>{const f=fixture();const r=await f.run();assert.equal(r.success,true);assert.equal(r.data.status,'Resolved');assert.equal(r.message,'Review closed.');assert.equal(f.writes(),1);assert.equal(f.filter().bookingId,undefined);assert.equal(f.filter().$expr.$eq[1],1)});
test('repeated review closure is idempotent',async()=>{const f=fixture({status:'Resolved'});assert.equal((await f.run()).success,true);assert.equal(f.writes(),0)});
test('service task must use normal completion',async()=>{const f=fixture({category:'Housekeeping'});assert.equal((await f.run()).code,409);assert.equal(f.writes(),0)});
test('HANDOFF in another department is still a reception review',async()=>{const f=fixture({category:'Maintenance',handoff:true});assert.equal((await f.run()).success,true)});
test('a concurrent guest update prevents closure',async()=>{const f=fixture({changed:true});assert.equal((await f.run()).code,409);assert.equal(f.filter().updatedAt,f.ticket.updatedAt)});
test('missing review returns 404 without writes',async()=>{const f=fixture({exists:false});assert.equal((await f.run()).code,404);assert.equal(f.writes(),0)});
test('related message lookup is scoped to current stay and ticket snapshot',()=>{const f=fixture();const query=f.service.relatedMessages(f.ticket);assert.equal(query.bookingId,'stay');assert.equal(query.direction,'INBOUND');assert.equal(query.$or[0].ticketId,'ticket');assert.equal(query.$or[1]._id.$in.join(','),'source,update')});
test('grouped outage review is identified independently of department',()=>{const f=fixture();assert.equal(f.service.isReceptionCategory({category:'Maintenance',staffReviewKey:'STAFF_REVIEW:stay'}),true)});
