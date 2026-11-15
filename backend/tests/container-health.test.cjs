const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { check } = require('../../deploy/healthcheck.cjs');
test('container health requires both backend readiness and the combined dashboard', async t => {
  const old = process.env.SERVE_FRONTEND;
  process.env.SERVE_FRONTEND = 'true';
  t.after(() => { if (old === undefined) delete process.env.SERVE_FRONTEND; else process.env.SERVE_FRONTEND = old; });
  let backendReady = true, dashboardReady = true;
  const server = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(backendReady ? 200 : 503); res.end(JSON.stringify({ status: backendReady ? 'OK' : 'UNAVAILABLE' })); }
    else { res.writeHead(dashboardReady ? 200 : 500); res.end('Synthetic dashboard'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    await check(port);
    dashboardReady = false;
    await assert.rejects(check(port), /Dashboard unavailable/);
    backendReady = false; dashboardReady = true;
    await assert.rejects(check(port), /Backend not ready/);
    backendReady = true; process.env.SERVE_FRONTEND = 'false'; dashboardReady = false;
    await check(port);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
