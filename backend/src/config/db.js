const mongoose = require('mongoose');
const dns = require('dns');

// Force Node to use Google Public DNS to resolve MongoDB +srv records
dns.setServers(['8.8.8.8', '8.8.4.4']);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`[MongoDB] Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`[MongoDB] Error: ${error.message}`);
  }
};

module.exports = connectDB;