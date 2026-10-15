const express = require('express');
const auth = require('../services/staffAuthService');
const Sessions = require('../models/StaffSession');
const Attempts = require('../models/StaffLoginAttempt');
const router = express.Router();
let hashing = 0;
router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });
router.get('/session', auth.requireStaff, (req,res) => res.json({ success: true, email: auth.account().email }));
router.post('/login', async (req,res) => {
  const configured = auth.account();
  if (!configured) return res.status(503).json({ success: false, message: 'Staff access has not been configured. Contact the administrator.' });
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 128) return res.status(400).json({ success: false, message: 'Enter your email address and password.' });
  try {
    // Fixed windows bound per-client attempts without saving a raw address.
    const windowMs = 15 * 60 * 1000;
    const bucket = Math.floor(Date.now()/windowMs);
    const row = await Attempts.findOneAndUpdate({ _id: auth.sha(`${req.ip}:${bucket}`) }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket+2)*windowMs) } }, { upsert: true, returnDocument: 'after' });
    if (row.count > 10 || hashing >= 2) {
      res.set('Retry-After', '60');
      return res.status(429).json({ success: false, message: 'Too many sign-in attempts. Please try again later.' });
    }
    let verified;
    hashing++;
    try { verified = await auth.verifyPassword(password, configured.passwordHash); }
    finally { hashing--; }
    if (!verified || email.trim().toLowerCase() !== configured.email) return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
    const old = auth.tokenFrom(req.headers);
    if (old) {
      const previous = await Sessions.findOneAndDelete({ tokenHash: auth.sha(old) });
      if (previous) require('../services/realtimeService').revokeSession(String(previous._id));
    }
    const token = auth.newToken();
    await Sessions.create({ tokenHash: auth.sha(token), accountFingerprint: configured.fingerprint, expiresAt: new Date(Date.now()+auth.SESSION_MS) });
    res.cookie(auth.COOKIE, token, auth.cookieOptions());
    return res.json({ success: true, email: configured.email });
  } catch (error) {
    console.error('Staff login failed:', error.name);
    return res.status(503).json({ success: false, message: 'Sign-in is temporarily unavailable. Please try again.' });
  }
});
router.post('/logout', async (req,res) => {
  try {
    const token = auth.tokenFrom(req.headers);
    if (token) {
      const session = await Sessions.findOneAndDelete({ tokenHash: auth.sha(token) });
      if (session) require('../services/realtimeService').revokeSession(String(session._id));
    }
    res.clearCookie(auth.COOKIE, { ...auth.cookieOptions(), maxAge: undefined });
    res.json({ success: true });
  } catch {
    res.status(503).json({ success: false, message: 'Sign-out could not be confirmed. Please try again.' });
  }
});
module.exports = router;
