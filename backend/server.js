const path = require("node:path");
const dns = require("node:dns");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

// Hosted services use their platform resolver. Retain the local ISP workaround.
if (process.env.NODE_ENV !== "production") dns.setServers(["8.8.8.8", "8.8.4.4"]);
const staffAuth = require("./src/services/staffAuthService");
const publicUrl = process.env.APP_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
if (publicUrl && !process.env.FRONTEND_ORIGINS) {
  process.env.FRONTEND_ORIGINS = new URL(publicUrl).origin;
}
const app = express();
const httpServer = require("node:http").createServer(app);
require("./src/services/realtimeService").startRealtime(httpServer);
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(cors({ origin: staffAuth.allowedOrigins(), credentials: true }));
app.use(express.json({ limit: "32kb" }));
let ready = false;
const telegram = require("./src/services/telegramService");
const transport = telegram.createTransport();
// This one secret-verified route belongs to Telegram, not the staff API.
transport.mount(app, () => ready && mongoose.connection.readyState === 1);
app.use("/api", staffAuth.requireOrigin);
app.use("/api/auth", require("./src/routes/staffAuthRoutes"));
app.use("/api", staffAuth.requireStaff);
app.use("/api/bookings", require("./src/routes/bookingRoutes"));
app.use("/api/tasks", require("./src/routes/taskRoutes"));
app.use("/api/conversations", require("./src/routes/conversationRoutes"));
// Unknown API paths must not fall through into Next.js's development proxy.
app.use("/api", (req, res) => res.status(404).json({ success: false, message: "API route not found." }));
app.get("/health", (req, res) => {
  const healthy = ready && mongoose.connection.readyState === 1;
  res.set("Cache-Control", "no-store").status(healthy ? 200 : 503).json({
    status: healthy ? "OK" : "UNAVAILABLE",
    message: healthy ? "Hotel Ops Backend is running" : "Service is starting or unavailable",
  });
});

let nextApp;
async function start() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
  if (process.env.NODE_ENV === "production" && !staffAuth.account()) throw new Error("Configure staff credentials before deployment.");
  if (process.env.SERVE_FRONTEND === "true") {
    // Use the existing frontend dependency tree; no second public service needed.
    const frontend = path.join(__dirname, "../frontend");
    nextApp = require(path.join(frontend, "node_modules/next"))({ dev: false, dir: frontend });
    await nextApp.prepare();
    const handle = nextApp.getRequestHandler();
    app.use((req, res, next) => Promise.resolve(handle(req, res)).catch(next));
  }
  app.use((error, req, res, next) => {
    console.error("Request failed:", error.name);
    if (res.headersSent) return next(error);
    res.status(500).json({ success: false, message: "Request could not be completed." });
  });
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log("Connected to MongoDB Atlas.");
  await Promise.all([
    require("./src/models/StaffSession").init(),
    require("./src/models/StaffLoginAttempt").init(),
  ]);
  const port = Number(process.env.PORT || 5000);
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "0.0.0.0", resolve);
  });
  await require("./src/services/jobWorker").startJobWorker();
  await transport.start(() => {
    console.error("Telegram polling stopped; restarting the service is required.");
    void shutdown(1);
  });
  ready = true;
  console.log(`Hotel service is listening on port ${port}.`);
}
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  ready = false;
  require("./src/services/jobWorker").stopJobWorker();
  const deadline = setTimeout(() => process.exit(code || 1), 25000);
  deadline.unref();
  try {
    await transport.stop();
    await require("./src/services/realtimeService").closeRealtime();
    if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve));
    if (nextApp) await nextApp.close();
    await mongoose.disconnect();
    clearTimeout(deadline);
    process.exit(code);
  } catch {
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
start().catch(error => {
  console.error("Service startup failed:", error.name, error.message);
  void shutdown(1);
});
