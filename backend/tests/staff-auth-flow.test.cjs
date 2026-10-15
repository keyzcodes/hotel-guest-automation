const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const auth = require('../src/services/staffAuthService');
// Integration exercises real Express/Socket.IO with an isolated in-memory session store.
// No Atlas database, Telegram or provider calls occur.
test('staff login, protected API, authenticated realtime, logout and expiry', async t => {
  const email='staff@example.test', password='Test-password-for-account-123';
  process.env.STAFF_EMAIL=email;process.env.STAFF_PASSWORD_HASH=await auth.hashPassword(password);
  const sessions=[];let throttle=0;
  const store={
    async create(data){const row={...data,_id:String(sessions.length+1)};sessions.push(row);return row;},
    findOne(filter){return {lean:async()=>sessions.find(row=>row.tokenHash===filter.tokenHash&&row.accountFingerprint===filter.accountFingerprint&&row.expiresAt>filter.expiresAt.$gt)||null};},
    async findOneAndDelete(filter){const at=sessions.findIndex(row=>row.tokenHash===filter.tokenHash);return at<0?null:sessions.splice(at,1)[0];},
  };
  require('../src/models/StaffSession');require.cache[require.resolve('../src/models/StaffSession')].exports=store;
  require('../src/models/StaffLoginAttempt');require.cache[require.resolve('../src/models/StaffLoginAttempt')].exports={findOneAndUpdate:async()=>({count:++throttle})};
  const app=express();app.use(express.json());app.use('/api',auth.requireOrigin);app.use('/api/auth',require('../src/routes/staffAuthRoutes'));app.use('/api',auth.requireStaff);
  app.get('/api/private',(req,res)=>res.json({success:true,record:'protected'}));
  const server=http.createServer(app);const realtime=require('../src/services/realtimeService');const io=realtime.startRealtime(server);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>io.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(url,options={})=>fetch(base+url,{...options,headers:{Origin:'http://localhost:3001',...options.headers},signal:AbortSignal.timeout(5000)});
  assert.equal((await call('/api/private')).status,401);
  const bad=await call('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'wrong'})});assert.equal(bad.status,401);assert.equal(bad.headers.get('set-cookie'),null);
  const login=await call('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(login.status,200);
  const rawCookie=login.headers.get('set-cookie');assert.match(rawCookie,/HttpOnly/i);assert.match(rawCookie,/SameSite=Lax/i);
  const cookie=rawCookie.split(';')[0];assert.equal(sessions.length,1);assert.equal(sessions[0].tokenHash.includes(cookie.split('=')[1]),false);
  assert.equal((await call('/api/private',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await call('/api/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:'https://untrusted.invalid'}})).status,403);
  // Engine.IO polling allows checking Socket.IO authentication using only built-in fetch.
  async function connect(cookieValue) {
    const headers=cookieValue?{Cookie:cookieValue}:{};
    const opened=await call('/socket.io/?EIO=4&transport=polling',{headers});
    const opening=await opened.text();const sid=JSON.parse(opening.slice(1)).sid;
    await call(`/socket.io/?EIO=4&transport=polling&sid=${sid}`,{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:'40'});
    const response=await call(`/socket.io/?EIO=4&transport=polling&sid=${sid}`,{headers});return {sid,packet:await response.text()};
  }
  const anonymous=await connect();assert.match(anonymous.packet,/44.*Please sign in/);
  const live=await connect(cookie);assert.match(live.packet,/40\{/);assert.equal(io.sockets.sockets.size,1);
  const out=await call('/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});assert.equal(out.status,200);assert.equal(sessions.length,0);assert.equal(io.sockets.sockets.size,0);
  assert.equal((await call('/api/private',{headers:{Cookie:cookie}})).status,401);
  const again=await call('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});const nextCookie=again.headers.get('set-cookie').split(';')[0];
  sessions[0].expiresAt=new Date(Date.now()-1000);assert.equal((await call('/api/private',{headers:{Cookie:nextCookie}})).status,401);
  sessions[0].expiresAt=new Date(Date.now()+100000);process.env.STAFF_PASSWORD_HASH=await auth.hashPassword('Changed-password-account-123');assert.equal((await call('/api/private',{headers:{Cookie:nextCookie}})).status,401);
  throttle=10;const limited=await call('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(limited.status,429);
});
