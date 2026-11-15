const http = require('node:http');
function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path, timeout: 2000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', data => { if (body.length < 65536) body += data; });
      res.on('end', () => resolve({ code: res.statusCode, body }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Error('Health timeout')));
    req.on('error', reject);
  });
}
async function check(port = Number(process.env.PORT || 5000)) {
  const health = await request(port, '/health');
  if (health.code !== 200 || JSON.parse(health.body).status !== 'OK') throw Error('Backend not ready');
  if (process.env.SERVE_FRONTEND === 'true') {
    const page = await request(port, '/');
    if (page.code < 200 || page.code >= 400) throw Error('Dashboard unavailable');
  }
}
if (require.main === module) check().catch(() => { process.exitCode = 1; });
module.exports = { check };
