const express = require('express');
const auth = require('../services/staffAuthService');
const service = require('../services/staffAccountService');
const Accounts = require('../models/StaffAccount');
const Sessions = require('../models/StaffSession');
const realtime = require('../services/realtimeService');
const router = express.Router();
let hashing = 0;

// This router is mounted after requireStaff. All staff see operational records;
// only the GM sees account management. Disabled deployments expose no directory.
router.use((req, res, next) => {
  if (!auth.individualAccountsEnabled()) return res.status(404).json({ success: false, message: 'Staff accounts are not enabled.' });
  next();
}, auth.requireGM);

router.get('/', async (req, res) => {
  try {
    const data = await Accounts.find({}).select('email name role active createdAt').sort({ name: 1 }).lean();
    res.json({ success: true, data });
  } catch { res.status(503).json({ success: false, message: 'Staff accounts could not be loaded.' }); }
});

router.post('/', async (req, res) => {
  let values;
  try { values = service.validateNewStaff(req.body); }
  catch (error) { return res.status(400).json({ success: false, message: error.message }); }
  if (hashing >= 2) return res.status(429).json({ success: false, message: 'Please try again shortly.' });
  hashing++;
  try {
    const passwordHash = await auth.hashPassword(values.password);
    const staff = await Accounts.create({ name: values.name, email: values.email, passwordHash,
      role: 'STAFF', active: true, createdBy: req.staffSession.staff.id });
    res.status(201).json({ success: true, data: auth.publicIdentity(staff) });
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 503).json({ success: false,
      message: error.code === 11000 ? 'That email address already has an account.' : 'Staff account could not be created.' });
  } finally { hashing--; }
});

router.patch('/:id', async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid staff ID.' });
  const body = req.body;
  if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.active !== 'boolean')
    return res.status(400).json({ success: false, message: 'Provide only an active true or false value.' });
  try {
    const data = await service.setStaffActive(req.params.id, body.active, { Accounts, Sessions, realtime });
    if (!data) return res.status(404).json({ success: false, message: 'Staff account not found. The GM account cannot be disabled here.' });
    res.json({ success: true, data: { ...data, active: body.active } });
  } catch { res.status(503).json({ success: false, message: 'Access change could not be confirmed. Refresh before retrying.' }); }
});

module.exports = router;
