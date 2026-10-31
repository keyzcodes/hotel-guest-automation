const mongoose = require('mongoose');
const { departments, categories } = require('./config');
const { MAX_KOBO, createInput } = require('./validation');
const integer = { validator: Number.isSafeInteger, message: 'Use integer kobo.' };
const snapshot = new mongoose.Schema({
  type: { type: String, enum: ['SALE', 'EXPENSE'], required: true },
  businessDate: { type: String, required: true },
  departmentId: { type: String, enum: departments.map(item => item.id), required: true },
  categoryId: { type: String, enum: [...Object.keys(categories), null], default: null },
  amountKobo: { type: Number, required: true, min: 0, max: MAX_KOBO, validate: integer },
  note: { type: String, maxlength: 500, default: '' },
  state: { type: String, enum: ['POSTED', 'VOID'], required: true },
}, { _id: false, strict: 'throw' });
const event = new mongoose.Schema({
  mutationId: { type: String, required: true },
  payloadHash: { type: String, required: true },
  action: { type: String, enum: ['CREATE', 'CORRECT', 'VOID'], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'StaffAccount' },
  actorName: { type: String, required: true, maxlength: 100 },
  at: { type: Date, required: true },
  reason: { type: String, maxlength: 200, default: '' },
  before: { type: snapshot, default: null }, after: { type: snapshot, required: true },
}, { _id: false, strict: 'throw' });
const schema = new mongoose.Schema({
  ...snapshot.obj,
  requestId: { type: String, required: true, unique: true },
  creationHash: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'StaffAccount' },
  version: { type: Number, required: true, default: 1, min: 1, validate: integer },
  history: { type: [event], required: true, validate: { validator: value => value.length > 0 && value.length <= 200, message: 'Entry history limit reached.' } },
}, { timestamps: true, strict: 'throw', collection: 'financialEntries' });

// Model writes receive the same business validation as the HTTP service. Raw
// database access is reserved for administration; it must not bypass this API.
schema.pre('validate', function () {
  if (!Number.isSafeInteger(this.amountKobo) || this.amountKobo < 0) return;
  const kobo = BigInt(this.amountKobo);
  createInput({ requestId: this.requestId, type: this.type,
    businessDate: this.businessDate, departmentId: this.departmentId,
    categoryId: this.categoryId, note: this.note,
    amount: `${kobo / 100n}.${String(kobo % 100n).padStart(2, '0')}` });
});

// Enforce one non-void daily sales total in MongoDB, including concurrent saves.
// Voiding releases the slot, while the original record/history remain available.
schema.index({ departmentId: 1, businessDate: 1 }, {
  name: 'one_posted_sale_per_day', unique: true,
  partialFilterExpression: { type: 'SALE', state: 'POSTED' },
});
schema.index({ state: 1, businessDate: 1, departmentId: 1 });
module.exports = mongoose.model('FinancialEntry', schema);
