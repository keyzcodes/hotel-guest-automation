const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const dns = require('dns');

// Force Google DNS to bypass ISP SRV DNS blocks
dns.setServers(['8.8.8.8', '8.8.4.4']);

dotenv.config();

const app = express();
const httpServer = require('http').createServer(app);
require('./src/services/realtimeService').startRealtime(httpServer);
app.use(cors());
app.use(express.json());

// Import Routes
const bookingRoutes = require('./src/routes/bookingRoutes');
const taskRoutes = require('./src/routes/taskRoutes');


// Mount Routes
app.use('/api/bookings', bookingRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/conversations', require('./src/routes/conversationRoutes'));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Hotel Ops Backend is running' });
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB Atlas');
    httpServer.listen(PORT, () => {
      require('./src/services/telegramService').startTelegramBot();
      require('./src/services/jobWorker').startJobWorker().catch(error => console.error('Job worker startup failed:', error.name));
      console.log(`🚀 Server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Database connection error:', err);
  });
