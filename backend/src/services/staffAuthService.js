const {
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
} = require("node:crypto");
const { promisify } = require("node:util");
const derive = promisify(scrypt);
const COOKIE = "hotel_staff_session";
const SESSION_MS = 8 * 60 * 60 * 1000;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const individualAccountsEnabled = () => process.env.STAFF_ACCOUNTS_ENABLED === "true";

// API responses expose identity, never password hashes or session tokens.
const publicIdentity = (staff) => ({
  id: String(staff._id), email: staff.email, name: staff.name, role: staff.role,
});
const allowedOrigins = () =>
  (
    process.env.FRONTEND_ORIGINS ||
    "http://localhost:3001,http://127.0.0.1:3001,http://localhost:3000,http://127.0.0.1:3000"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
function account() {
  const email = (process.env.STAFF_EMAIL || "").trim().toLowerCase();
  const passwordHash = process.env.STAFF_PASSWORD_HASH || "";
  if (
    !email ||
    !/^scrypt\$32768\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(passwordHash)
  )
    return null;
  return { email, passwordHash, fingerprint: sha(`${email}:${passwordHash}`) };
}
async function hashPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw Error("Use a password between 12 and 128 characters.");
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$${salt}$${key.toString("hex")}`;
}
async function verifyPassword(password, encoded) {
  if (
    typeof password !== "string" ||
    password.length > 128 ||
    !/^scrypt\$32768\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded)
  )
    return false;
  const parts = encoded.split("$");
  const actual = await derive(password, parts[2], 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(actual, Buffer.from(parts[3], "hex"));
}
function tokenFrom(headers = {}) {
  const values = String(headers.cookie || "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${COOKIE}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MS,
  };
}
async function authenticate(
  headers,
  Sessions = require("../models/StaffSession"),
  Accounts,
) {
  const configured = account(),
    token = tokenFrom(headers);
  if (!token) return null;
  if (individualAccountsEnabled()) {
    const session = await Sessions.findOne({
      tokenHash: sha(token), staffId: { $exists: true },
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!session) return null;
    const staff = await (Accounts || require('../models/StaffAccount')).findOne({
      _id: session.staffId, active: true, authVersion: session.authVersion,
    }).lean();
    return staff ? { ...session, staff: publicIdentity(staff) } : null;
  }
  if (!configured) return null;
  const session = await Sessions.findOne({
    tokenHash: sha(token),
    accountFingerprint: configured.fingerprint,
    expiresAt: { $gt: new Date() },
  }).lean();
  return session ? { ...session, staff: { email: configured.email, name: 'Hotel staff', role: 'GM' } } : null;
}
function requireGM(req, res, next) {
  if (req.staffSession?.staff?.role === 'GM') return next();
  return res.status(403).json({ success: false, message: 'Only the GM can manage staff accounts.' });
}
async function requireStaff(req, res, next) {
  res.set("Cache-Control", "no-store");
  try {
    const session = await authenticate(req.headers);
    if (!session)
      return res
        .status(401)
        .json({ success: false, message: "Please sign in." });
    req.staffSession = session;
    next();
  } catch {
    res
      .status(503)
      .json({
        success: false,
        message: "Sign-in verification is temporarily unavailable.",
      });
  }
}
function requireOrigin(req, res, next) {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    allowedOrigins().includes(req.headers.origin)
  )
    return next();
  return res
    .status(403)
    .json({ success: false, message: "Request origin is not allowed." });
}
module.exports = {
  COOKIE,
  SESSION_MS,
  sha,
  account,
  hashPassword,
  verifyPassword,
  tokenFrom,
  cookieOptions,
  authenticate,
  requireStaff,
  requireOrigin,
  allowedOrigins,
  individualAccountsEnabled,
  publicIdentity,
  requireGM,
  newToken: () => randomBytes(32).toString("hex"),
};
