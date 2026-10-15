const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const id = '123456789012345678901234';
function fixture({ invitation = true, already = false } = {}) {
  const writes = [], lookups = []; let stored = already ? 4 : null;
  const Booking = { findOneAndUpdate: async (query, update) => { writes.push({ query, update }); if (stored != null) return null; stored = update.$set.guestRating; return { _id: id }; }, findOne: async () => stored == null ? null : { guestRating: stored } };
  const Message = { findOne: async query => { lookups.push(query); return invitation ? {} : null; } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/guestFeedbackService.js'), 'utf8'), { module, require: name => name.includes('Booking') ? Booking : Message, console, Date });
  const ctx = { chat: { id: 42, type: 'private' }, from: { id: 42 }, callbackQuery: { data: `RATING_${id}_2`, message: { message_id: 99 } } };
  return { service: module.exports, ctx, writes, lookups, stored: () => stored };
}
test('rating is scoped to exact invitation, chat and confirmed completed stay', async () => {
  const f = fixture(); await f.service.saveGuestRating(f.ctx);
  assert.equal(f.stored(), 2); const q = f.lookups[0]; assert.equal(q.bookingId, id); assert.equal(q.chatId, '42'); assert.equal(q.providerMessageId, '99'); assert.equal(q.deliveryState, 'SENT');
  const write = f.writes[0]; assert.equal(write.query.stayStatus, 'COMPLETED'); assert.equal(write.query.confirmedCheckoutAt.$ne, null); assert.equal(write.update.$set.stayStatus, undefined);
});
test('repeated or changed taps preserve the first rating and count once', async () => {
  const f = fixture(); await f.service.saveGuestRating(f.ctx); f.ctx.callbackQuery.data = `RATING_${id}_5`; const result = await f.service.saveGuestRating(f.ctx);
  assert.equal(f.stored(), 2); assert.equal(result.reply, null);
});
test('legacy and malformed callback data cannot guess a stay', async () => {
  for (const data of ['RATING_5', `RATING_${id}_0`, `RATING_${id}_6`, 'bad']) { const f = fixture(); f.ctx.callbackQuery.data = data; await f.service.saveGuestRating(f.ctx); assert.equal(f.writes.length, 0); }
});
test('unrecognised invitation or foreign chat cannot write ratings', async () => {
  const f = fixture({ invitation: false }); await f.service.saveGuestRating(f.ctx); assert.equal(f.writes.length, 0);
  const other = fixture(); other.ctx.from.id = 43; await other.service.saveGuestRating(other.ctx); assert.equal(other.writes.length, 0);
});
test('group chat feedback cannot update a guest stay', async () => {
  const f = fixture(); f.ctx.chat.type = 'group'; await f.service.saveGuestRating(f.ctx); assert.equal(f.writes.length, 0);
});
test('database failure does not return a false saved acknowledgement', async () => {
  const f = fixture(); await assert.rejects(f.service.saveGuestRating(f.ctx, { Booking: { findOneAndUpdate: async () => { throw Error('database'); } }, Message: { findOne: async () => ({}) } }), /database/);
});
function scheduleFixture() {
  const calls = [], module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/schedulingService.js'), 'utf8'), { module, Date, require: () => ({ updateOne: async (...args) => calls.push(args) }) });
  const booking = { _id: id, checkInTime: new Date('2026-10-15T10:00:00Z'), checkOutTime: new Date('2026-10-15T10:03:00Z'), stayStatus: 'COMPLETED' };
  return { calls, booking, service: module.exports };
}
test('demo welcome, satisfaction and reminder use zero, one and two minute offsets', async () => {
  const f = scheduleFixture(); await f.service.scheduleCheckInJobs(f.booking, { pulseDelayMs: 60000, checkoutReminderLeadMs: 60000, reminderDelayMs: 120000 });
  assert.deepEqual(f.calls.map(c => new Date(c[1].$setOnInsert.scheduledFor).getTime() - f.booking.checkInTime.getTime()), [0, 60000, 120000]);
});
test('feedback becomes due at confirmed checkout without extra delay', async () => {
  const f = scheduleFixture(); const at = new Date(); await f.service.scheduleReviewJob(f.booking, at); assert.equal(f.calls[0][1].$setOnInsert.scheduledFor.getTime(), at.getTime());
});
test('reminder after departure is not scheduled', async () => {
  const f = scheduleFixture(); f.booking.checkOutTime = new Date('2026-10-15T10:01:30Z'); await f.service.scheduleCheckInJobs(f.booking, { pulseDelayMs: 60000, reminderDelayMs: 120000 }); assert.equal(f.calls.length, 2);
});
test('normal schedule retains fifteen minute pulse and thirty minute checkout lead', async () => {
  const f = scheduleFixture(); f.booking.checkOutTime = new Date('2026-10-16T10:00:00Z'); await f.service.scheduleCheckInJobs(f.booking);
  assert.equal(f.calls[1][1].$setOnInsert.scheduledFor.getTime() - f.booking.checkInTime.getTime(), 900000);
  assert.equal(f.booking.checkOutTime.getTime() - f.calls[2][1].$setOnInsert.scheduledFor.getTime(), 1800000);
});
function telegramFixture() {
  const sends = [], callbacks = [], module = { exports: {} };
  class InlineKeyboard { constructor() { this.rows = [[]]; } text(label, data) { this.rows.at(-1).push({ text: label, callback_data: data }); return this; } url(label, url) { this.rows.at(-1).push({ text: label, url }); return this; } row() { this.rows.push([]); return this; } }
  class Bot { constructor() { this.api = { sendMessage: async (...args) => { sends.push(args); return { message_id: 99 }; } }; } on(...args) { callbacks.push(args); } catch() {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/telegramService.js'), 'utf8'), { module, console, process: { env: { TELEGRAM_BOT_TOKEN: 'test' } }, Date, URL, require: name => name === 'grammy' ? { Bot, InlineKeyboard } : name === 'dotenv' ? { config() {} } : { name: 'Demo Hotel', googleReviewUrl: 'https://www.google.com/maps/place/demo' } });
  return { sends, service: module.exports };
}
test('review invitation always includes labelled public URL and stay-bound rating buttons', async () => {
  const f = telegramFixture(); await f.service.sendReviewPrompt('42', { _id: id, guestName: 'Guest' });
  const [, text, options] = f.sends[0]; const buttons = options.reply_markup.rows.flat();
  assert.equal(text.includes('https://'), false); assert.equal(buttons[0].text, 'Leave a Google review ↗'); assert.equal(buttons[0].url, 'https://www.google.com/maps/place/demo');
  assert.deepEqual(buttons.slice(1).map(b => b.callback_data), [1,2,3,4,5].map(n => `RATING_${id}_${n}`));
});
test('reminder uses actual Lagos checkout time, never a hardcoded thirty minute claim', async () => {
  const f = telegramFixture(); await f.service.sendPreCheckoutPrompt('42', '101', { checkOutTime: '2026-10-15T10:03:00Z' });
  assert.match(f.sends[0][1], /11:03/); assert.equal(f.sends[0][1].includes('30 minutes'), false);
});

test('reminder includes truthful thirty minute countdown near actual checkout', async () => {
  const f = telegramFixture(); await f.service.sendPreCheckoutPrompt('42', '101', { checkOutTime: new Date(Date.now() + 30 * 60000).toISOString() });
  assert.match(f.sends[0][1], /about 30 minutes/);
});
