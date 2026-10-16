const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { Bot } = require('grammy');
const { createTelegramTransport } = require('../src/services/telegramTransportService');
const secret = 'a'.repeat(48);
const headerSecret = require('node:crypto').createHash('sha256').update(secret).digest('hex');
const env = { TELEGRAM_MODE: 'webhook', APP_PUBLIC_URL: 'https://hotel.example', TELEGRAM_WEBHOOK_SECRET: secret };
function fake() {
  const calls = [];
  return { calls, api: { getWebhookInfo: async () => ({url:''}), setWebhook: async (...args) => calls.push(args) }, init: async () => {}, start: async () => calls.push('poll'), isRunning: () => false };
}
test('webhook validates mode, HTTPS origin and secret before registration', () => {
  assert.throws(() => createTelegramTransport(fake(), {TELEGRAM_MODE:'invalid'}));
  for (const APP_PUBLIC_URL of ['http://hotel.example','https://hotel.example/path','https://user:pass@hotel.example','https://hotel.example?x=1']) {
    assert.throws(() => createTelegramTransport(fake(), {...env, APP_PUBLIC_URL}));
  }
  assert.throws(() => createTelegramTransport(fake(), {...env, TELEGRAM_WEBHOOK_SECRET:'short'}));
});
test('registration preserves queued updates and does not start polling', async () => {
  const bot = fake(); await createTelegramTransport(bot,env).start(assert.fail);
  assert.equal(bot.calls.length,1);
  assert.equal(bot.calls[0][0],'https://hotel.example/telegram/webhook');
  assert.equal(bot.calls[0][1].secret_token,headerSecret);
  assert.equal(bot.calls[0][1].drop_pending_updates,false);
  assert.equal(bot.calls[0][1].max_connections,1);
});
test('Render URL can supply public origin', async () => {
  const bot = fake(); await createTelegramTransport(bot,{...env,APP_PUBLIC_URL:undefined,RENDER_EXTERNAL_URL:'https://hotel.onrender.com'}).start(assert.fail);
  assert.equal(bot.calls[0][0],'https://hotel.onrender.com/telegram/webhook');
});
test('local polling refuses to silently replace an existing hosted webhook', async () => {
  const bot = fake(); bot.api.getWebhookInfo = async () => ({url:'https://hotel.example/telegram/webhook'});
  await assert.rejects(createTelegramTransport(bot,{}).start(assert.fail),/already configured/);
  assert.equal(bot.calls.length,0);
});
test('polling starts only without an existing webhook and reports runtime failure', async () => {
  const bot = fake(); await createTelegramTransport(bot,{}).start(assert.fail);
  assert.deepEqual(bot.calls,['poll']);
  const err = new Error('stopped'); bot.start = async () => {throw err};
  let failure; await createTelegramTransport(bot,{}).start(e => {failure=e});
  await new Promise(resolve => setImmediate(resolve)); assert.equal(failure,err);
});
test('real webhook middleware rejects forged requests, waits for processing and propagates failures', async t => {
  const bot = new Bot('123:test',{botInfo:{id:123,is_bot:true,first_name:'Test',username:'test_bot'}});
  let calls = 0, release, started;
  const entered = new Promise(resolve => {started=resolve});
  bot.on('message:text', async () => {calls++; started(); await new Promise(resolve => {release=resolve});});
  const app = express(); app.use(express.json());
  createTelegramTransport(bot,env).mount(app);
  app.use((err,req,res,next) => res.status(500).end());
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/telegram/webhook`;
  const body = JSON.stringify({update_id:1,message:{message_id:1,date:1,chat:{id:1,type:'private'},from:{id:1,is_bot:false,first_name:'Guest'},text:'hello'}});
  const options = key => ({method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':key},body});
  assert.equal((await fetch(url,options('wrong'))).status,401); assert.equal(calls,0);
  let finished=false;
  const response = fetch(url,options(headerSecret)).then(r => {finished=true;return r});
  await entered; assert.equal(finished,false); release();
  assert.equal((await response).status,200); assert.equal(calls,1);
  bot.handleUpdate = async () => {throw new Error('storage unavailable')};
  assert.equal((await fetch(url,options(headerSecret))).status,500);
});
test('unready webhook returns retryable failure without processing an update', async t => {
  const bot = new Bot('123:test',{botInfo:{id:123,is_bot:true,first_name:'Test',username:'test_bot'}});
  let calls=0; bot.handleUpdate = async () => {calls++};
  const app=express(); app.use(express.json()); createTelegramTransport(bot,env).mount(app,()=>false);
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const r=await fetch(`http://127.0.0.1:${server.address().port}/telegram/webhook`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,503); assert.equal(calls,0);
});

test('Render base64 secret is safely adapted to Telegram header characters', async () => {
  const bot=fake();
  await createTelegramTransport(bot,{...env,TELEGRAM_WEBHOOK_SECRET:'B0jrphAPOY7pg92AN0c9MN4yecczLMdwnx4OkA1KFUk='}).start(assert.fail);
  assert.match(bot.calls[0][1].secret_token,/^[a-f0-9]{64}$/);
});
