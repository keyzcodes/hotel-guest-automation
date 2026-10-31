const auth = require('./staffAuthService');

function validateNewStaff(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['email', 'name', 'password'].includes(key))) {
    throw new Error('Provide only name, email and password.');
  }
  const { name, email, password } = body;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100)
    throw new Error('Enter a staff name of at most 100 characters.');
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    throw new Error('Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    throw new Error('Use a password between 12 and 128 characters.');
  return { name: name.trim(), email: email.trim().toLowerCase(), password };
}

async function revokeStaffSessions(id, Sessions, realtime) {
  const sessions = await Sessions.find({ staffId: id }).select('_id').lean();
  await Sessions.deleteMany({ staffId: id });
  for (const session of sessions) realtime.revokeSession(String(session._id));
}

// Keep one bootstrap GM in v1. Normal account management cannot remove or
// demote that account, avoiding accidental lockout and concurrent last-GM races.
async function setStaffActive(id, active, { Accounts, Sessions, realtime }) {
  const staff = await Accounts.findOneAndUpdate(
    { _id: id, role: 'STAFF' },
    { $set: { active }, $inc: { authVersion: 1 } },
    { returnDocument: 'after', runValidators: true },
  );
  if (!staff) return null;
  await revokeStaffSessions(id, Sessions, realtime);
  return auth.publicIdentity(staff);
}

module.exports = { validateNewStaff, revokeStaffSessions, setStaffActive };
