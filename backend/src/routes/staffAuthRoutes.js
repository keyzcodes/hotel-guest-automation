const express = require('express');
const auth = require('../services/staffAuthService');
const Sessions = require('../models/StaffSession');
const Attempts = require('../models/StaffLoginAttempt');
const router = express.Router();
let hashing = 0;
function workspace(staff) {
  return { ...staff,
    hotelName: (process.env.HOTEL_NAME || require('../config/hotel').name).trim(),
    modules: { salesExpenses: require('../modules/sales-expenses/config').enabled() },
    guestMessagingEnabled: process.env.GUEST_MESSAGING_ENABLED !== 'false',
  };
}
router.use((req,res,next) => { res.set('Cache-Control','no-store'); next(); });
router.get('/branding', (req, res) => res.json({ hotelName: workspace({}).hotelName }));
router.get('/session', auth.requireStaff, (req,res) => res.json({ success: true, ...workspace(req.staffSession.staff) }));
router.post('/login', async (req,res) => {
  const configured = auth.account();
  if (!auth.individualAccountsEnabled() && !configured) return res.status(503).json({ success: false, message: 'Staff access has not been configured. Contact the administrator.' });
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
    const staff = auth.individualAccountsEnabled()
      ? await require('../models/StaffAccount').findOne({ email: email.trim().toLowerCase(), active: true }).select('+passwordHash').lean()
      : configured;
    // Unknown emails perform the same expensive derivation as known accounts.
    const dummyHash = `scrypt$32768$${'0'.repeat(32)}$${'0'.repeat(128)}`;
    let verified;
    hashing++;
    try { verified = await auth.verifyPassword(password, staff?.passwordHash || dummyHash); }
    finally { hashing--; }
    if (!verified || !staff || email.trim().toLowerCase() !== staff.email) return res.status(401).json({ success: false, message: 'Email or password is incorrect.' });
    const old = auth.tokenFrom(req.headers);
    if (old) {
      const previous = await Sessions.findOneAndDelete({ tokenHash: auth.sha(old) });
      if (previous) require('../services/realtimeService').revokeSession(String(previous._id));
    }
    const token = auth.newToken();
    const identity = auth.individualAccountsEnabled()
      ? { staffId: staff._id, authVersion: staff.authVersion }
      : { accountFingerprint: configured.fingerprint };
    await Sessions.create({ tokenHash: auth.sha(token), ...identity, expiresAt: new Date(Date.now()+auth.SESSION_MS) });
    res.cookie(auth.COOKIE, token, auth.cookieOptions());
    return res.json({ success: true, ...workspace(auth.individualAccountsEnabled() ? auth.publicIdentity(staff) : { email: configured.email, name: 'Hotel staff', role: 'GM' }) });
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
