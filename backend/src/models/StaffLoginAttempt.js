const mongoose = require('mongoose');
// Atomic counters persist through restarts. TTL removes expired time buckets.
const schema = new mongoose.Schema({ _id: String, count: { type: Number, default: 0 }, expiresAt: { type: Date, required: true, index: { expires: 0 } } });
module.exports = mongoose.model('StaffLoginAttempt', schema);
