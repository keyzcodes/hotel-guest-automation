const mongoose = require('mongoose');

// Accounts are local to this hotel's database; passwords never leave this model.
const schema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  role: { type: String, required: true, enum: ['GM', 'STAFF'] },
  active: { type: Boolean, default: true, required: true },
  passwordHash: { type: String, required: true, select: false },
  // Changing credentials or access invalidates previously issued sessions.
  authVersion: { type: Number, default: 1, required: true, min: 1 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffAccount', default: null },
}, { timestamps: true });

module.exports = mongoose.model('StaffAccount', schema);
