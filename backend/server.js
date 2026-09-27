// backend/server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const demoRoutes = require('./routes/demo');
const webhookRoutes = require('./routes/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/demo', demoRoutes);
app.use('/webhook', webhookRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Automated Guest Operations Engine Running' });
});

app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`  HOTEL GUEST OPS ENGINE (BACKEND RUNNING)`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Mode: ${process.env.WHATSAPP_TOKEN ? 'LIVE META API' : 'CONSOLE MOCK MODE'}`);
  console.log(`==================================================\n`);
});