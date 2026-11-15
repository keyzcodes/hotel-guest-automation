const Session = require('../models/GuestEnquirySession');
const { initialState } = require('./enquiryState');
async function openSession({ hotelId, chatId, seed }) {
  const scope = { hotelId, chatId };
  let row = await Session.findOne(scope).lean();
  if (!row) {
    try { row = (await Session.create({ ...scope, snapshot: initialState(seed) })).toObject(); }
    catch (error) {
      if (error.code !== 11000) throw error;
      row = await Session.findOne(scope).lean();
    }
  }
  return {
    id: String(row._id), version: row.version, state: { ...initialState(), ...row.snapshot, stay: row.snapshot.stay ?? {} },
    async save(expectedVersion, state) {
      const changed = await Session.findOneAndUpdate({ ...scope, _id: row._id, version: expectedVersion }, {
        $set: { snapshot: state }, $inc: { version: 1 },
      }, { returnDocument: 'after', runValidators: true }).lean();
      if (!changed) throw Object.assign(Error('Enquiry changed concurrently'), { code: 'STATE_CHANGED' });
      return { version: changed.version, state: changed.snapshot };
    },
  };
}
module.exports = { openSession };
