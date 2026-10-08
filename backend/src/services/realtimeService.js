const { Server } = require('socket.io');
let io;
const allowedOrigins = () => (process.env.FRONTEND_ORIGINS || 'http://localhost:3001,http://127.0.0.1:3001').split(',').map(value => value.trim()).filter(Boolean);
function startRealtime(server) {
  if (io) throw new Error('Realtime already started');
  io = new Server(server, {
    cors: { origin: allowedOrigins(), methods: ['GET', 'POST'] },
    allowRequest: (request, callback) => callback(null, allowedOrigins().includes(request.headers.origin)),
  });
  return io;
}
function publishChange(collection) {
  if (io) io.emit('records:changed', { collection });
}
module.exports = { startRealtime, publishChange };
