const mongoose = require('mongoose');
// Only the token digest is saved. Browser cookies hold the random opaque token.
const schema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  accountFingerprint: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });
module.exports = mongoose.model('StaffSession', schema);
