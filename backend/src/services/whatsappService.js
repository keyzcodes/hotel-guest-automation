const { randomUUID } = require('node:crypto');
const { senderJid } = require('./whatsappIdentity');
let socket;
let connected = false;
function safeError(label, error) {
  console.error(label, error?.name || 'Error', error?.code || error?.output?.statusCode || '');
}
async function sendStaffReply(jid, text) {
  if (!connected || !socket) throw Error('WhatsApp is disconnected. No send was attempted.');
  if (!/^[1-9]\d{7,14}@s\.whatsapp\.net$/.test(jid)) throw Error('A verified phone address is required.');
  const sent = await socket.sendMessage(jid, { text });
  if (!sent?.key?.id) throw Error('WhatsApp did not confirm a message ID.');
  return { message_id: sent.key.id, text };
}
function createTransport() {
  let client, collection, state, codec, leaseTimer, reconnectTimer;
  let stopping = false, attempts = 0, pending = Promise.resolve(), inbound = Promise.resolve();
  const owner = randomUUID();
  const sessionId = 'business-test'; // Same lab session can be reused after stopping the standalone lab.
  const silent = { level: 'silent', child() { return this; }, trace(){}, debug(){}, info(){}, warn(){}, error(){}, fatal(){} };
  let fatal = () => {};
  function save() {
    const blob = codec.seal(state);
    pending = pending.then(async () => {
      const saved = await collection.updateOne(
        { _id: sessionId, owner },
        { $set: { blob, lockUntil: new Date(Date.now() + 60000) } }
      );
      if (!saved.matchedCount) throw Error('WhatsApp session lease was lost.');
    });
    void pending.catch(error => { safeError('WhatsApp session save failed:', error); fatal(); });
    return pending;
  }
  return {
    mount() {},
    async start(onFailure) {
      const [{ default: makeWASocket, BufferJSON, DisconnectReason, initAuthCreds, proto }, { MongoClient }, qr, { sessionCodec }] = await Promise.all([
        import('@whiskeysockets/baileys'), import('mongodb'), import('qrcode-terminal'), import('./whatsappSessionCodec.mjs')
      ]);
      fatal = () => { connected = false; onFailure(); };
      const uri = process.env.WHATSAPP_SESSION_MONGO_URI;
      if (!/^mongodb(?:\+srv)?:\/\/[^/]+\/sesora_whatsapp_lab(?:\?|$)/.test(uri || '')) throw Error('Use a lab-only WHATSAPP_SESSION_MONGO_URI for sesora_whatsapp_lab.');
      codec = sessionCodec(process.env.WHATSAPP_SESSION_KEY, BufferJSON);
      client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
      await client.connect();
      collection = client.db('sesora_whatsapp_lab').collection('sessions');
      // A lock protects separate integration processes. Stop the old lab first:
      // its earlier standalone version does not participate in this lock.
      await collection.updateOne({ _id: sessionId }, { $setOnInsert: { blob: null } }, { upsert: true });
      const saved = await collection.findOneAndUpdate(
        { _id: sessionId, $or: [{ owner: { $exists: false } }, { lockUntil: { $lt: new Date() } }] },
        { $set: { owner, lockUntil: new Date(Date.now() + 60000) } },
        { returnDocument: 'after' }
      );
      if (!saved) throw Error('WhatsApp session is in use. Stop the other integration process or wait 60 seconds.');
      state = saved.blob ? codec.open(saved.blob) : { creds: initAuthCreds(), keys: {} };
      leaseTimer = setInterval(() => {
        pending = pending.then(async () => {
          const lease = await collection.updateOne({ _id: sessionId, owner }, { $set: { lockUntil: new Date(Date.now() + 60000) } });
          if (!lease.matchedCount) throw Error('Session ownership changed.');
        });
        void pending.catch(error => { safeError('WhatsApp lease failed:', error); fatal(); });
      }, 20000);
      function connect() {
        if (stopping) return;
        connected = false;
        socket = makeWASocket({
          logger: silent, syncFullHistory: false, markOnlineOnConnect: false,
          auth: {
            creds: state.creds,
            keys: {
              async get(type, ids) {
                const result = Object.create(null);
                for (const id of ids) {
                  const value = state.keys[type]?.[id];
                  if (value != null) result[id] = type === 'app-state-sync-key' ? proto.Message.AppStateSyncKeyData.fromObject(value) : value;
                }
                return result;
              },
              async set(changes) {
                for (const [type, entries] of Object.entries(changes)) {
                  state.keys[type] ??= Object.create(null);
                  for (const [id, value] of Object.entries(entries)) {
                    if (value == null) delete state.keys[type][id];
                    else state.keys[type][id] = value;
                  }
                }
                await save();
              }
            }
          }
        });
        const current = socket;
        current.ev.on('creds.update', update => { Object.assign(state.creds, update); void save(); });
        current.ev.on('connection.update', ({ qr: code, connection, lastDisconnect }) => {
          if (stopping || socket !== current) return;
          if (code) qr.default.generate(code, { small: true });
          if (connection === 'open') {
            connected = true; attempts = 0;
            console.log('WhatsApp connected. Registered test guests can now send requests.');
          }
          if (connection === 'close') {
            connected = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            if ([DisconnectReason.loggedOut, DisconnectReason.connectionReplaced].includes(code) || ++attempts > 5) { fatal(); return; }
            reconnectTimer = setTimeout(() => { void pending.then(connect).catch(fatal); }, 2000);
          }
        });
        current.ev.on('messages.upsert', ({ type, messages }) => {
          if (type !== 'notify') return;
          for (const message of messages) {
            if (message.key.fromMe || !message.key.id || !/^[^@]+@(s\.whatsapp\.net|lid)$/.test(message.key.remoteJid || '')) continue;
            inbound = inbound.then(async () => {
              if (stopping || current !== socket) return;
              let jid = senderJid(message.key);
              // New WhatsApp identities may arrive as LIDs. Use Baileys' verified
              // identity mapping; never interpret a LID's digits as a phone.
              if (!jid && message.key.remoteJid.endsWith('@lid')) {
                const pn = await current.signalRepository?.lidMapping?.getPNForLID(message.key.remoteJid);
                if (pn) jid = senderJid({ remoteJid: pn });
              }
              const raw = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
              const text = typeof raw === 'string' && raw.trim() ? raw.slice(0, 8000) : '[Non-text message — please review in WhatsApp]';
              // Unresolved identities are saved for review and get no automatic response.
              const chatId = jid || message.key.remoteJid;
              await require('./guestMessageService').processGuestMessage({
                channel: 'WHATSAPP',
                chat: { id: chatId },
                message: { text, message_id: message.key.id },
                reply: text => sendStaffReply(chatId, text),
                reviewOnly: !jid || !raw
              });
            }).catch(error => { safeError('WhatsApp request processing failed:', error); });
          }
        });
      }
      connect();
    },
    async stop() {
      stopping = true; connected = false;
      clearInterval(leaseTimer); clearTimeout(reconnectTimer);
      socket?.end();
      await inbound.catch(() => {});
      await pending.catch(() => {});
      if (collection) await collection.updateOne({ _id: sessionId, owner }, { $unset: { owner: '', lockUntil: '' } }).catch(() => {});
      await client?.close();
    }
  };
}
module.exports = { createTransport, sendStaffReply };
