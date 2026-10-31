const { Server } = require('socket.io');
const auth = require('./staffAuthService');
let io;
function startRealtime(server) {
  if (io) throw new Error('Realtime already started');
  io = new Server(server, {
    cors: { origin: auth.allowedOrigins(), methods: ['GET', 'POST'], credentials: true },
    // Missing Origin is allowed for same-origin proxied polling; authentication is mandatory.
    allowRequest: (request, callback) => callback(null, !request.headers.origin || auth.allowedOrigins().includes(request.headers.origin)),
    pingInterval: 15000, pingTimeout: 10000,
  });
  io.use(async (socket,next) => {
    try {
      const session = await auth.authenticate(socket.request.headers);
      if (!session) return next(new Error('Please sign in.'));
      socket.data.staffSession = session;
      next();
    } catch { next(new Error('Sign-in verification unavailable.')); }
  });
  io.on('connection', socket => {
    const session = socket.data.staffSession;
    socket.join(`staff-session:${session._id}`);
    // Disconnect at absolute expiry even when no new HTTP request is made.
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0,new Date(session.expiresAt).getTime()-Date.now()));
    timer.unref?.();
    // Recheck account access even when a connected client makes no HTTP calls.
    const accessTimer = auth.individualAccountsEnabled() ? setInterval(async () => {
      try {
        if (!await auth.authenticate(socket.request.headers)) socket.disconnect(true);
      } catch { socket.disconnect(true); }
    }, 30000) : null;
    accessTimer?.unref?.();
    socket.on('disconnect', () => { clearTimeout(timer); if (accessTimer) clearInterval(accessTimer); });
  });
  return io;
}
function revokeSession(id) { io?.in(`staff-session:${id}`).disconnectSockets(true); }
async function publishChange(collection) {
  if (!io) return;
  const configured = auth.account();
  for (const socket of io.sockets.sockets.values()) {
    const session = socket.data.staffSession;
    try {
      const valid = auth.individualAccountsEnabled()
        ? await auth.authenticate(socket.request.headers)
        : configured && session?.accountFingerprint === configured.fingerprint && new Date(session.expiresAt) > new Date();
      if (!valid) socket.disconnect(true);
      else socket.emit('records:changed', { collection });
    } catch { socket.disconnect(true); }
  }
}
function closeRealtime() {
  if (!io) return Promise.resolve();
  const current = io; io = undefined;
  return new Promise(resolve => current.close(resolve));
}
module.exports = { startRealtime, publishChange, revokeSession, closeRealtime };
