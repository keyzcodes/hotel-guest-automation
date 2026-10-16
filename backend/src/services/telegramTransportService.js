const { webhookCallback } = require("grammy");

// Keep transport selection separate from guest decisions and message delivery.
function createTelegramTransport(bot, env = process.env) {
  const mode = env.TELEGRAM_MODE || "polling";
  if (!["polling", "webhook"].includes(mode)) {
    throw new Error("TELEGRAM_MODE must be polling or webhook.");
  }
  const path = "/telegram/webhook";
  let origin, secret;
  if (mode === "webhook") {
    const url = new URL(env.APP_PUBLIC_URL || env.RENDER_EXTERNAL_URL || "");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("APP_PUBLIC_URL must be a public HTTPS origin without a path.");
    }
    origin = url.origin;
    const configuredSecret = env.TELEGRAM_WEBHOOK_SECRET || "";
    if (!/^[A-Za-z0-9_+\/=\-]{32,256}$/.test(configuredSecret)) {
      throw new Error("Set TELEGRAM_WEBHOOK_SECRET to a random 32 to 256 character secret.");
    }
    // Render generates base64 secrets. Derive stable hex for Telegram's stricter
    // header alphabet without storing or logging a second credential.
    secret = require("node:crypto").createHash("sha256").update(configuredSecret).digest("hex");
  }
  return {
    mode,
    mount(app, ready = () => true) {
      if (mode !== "webhook") return;
      // Telegram authenticates using its secret header, not a staff browser cookie.
      // Never acknowledge before the middleware completes or swallow its failure.
      const handler = webhookCallback(bot, "express", {
        secretToken: secret, onTimeout: "throw", timeoutMilliseconds: 55000,
      });
      app.post(path, (req, res, next) => {
        if (!ready()) return res.sendStatus(503);
        Promise.resolve(handler(req, res)).catch(next);
      });
    },
    async start(onPollingFailure) {
      if (mode === "webhook") {
        await bot.init();
        await bot.api.setWebhook(`${origin}${path}`, {
          secret_token: secret,
          // Retain serial update handling for this small guided demo. A durable,
          // per-stay concurrent inbox is a separate production improvement.
          max_connections: 1,
          allowed_updates: ["message", "callback_query"],
          drop_pending_updates: false,
        });
        console.log("Telegram webhook is registered.");
      } else {
        // Do not let an accidental local startup silently take over the cloud bot.
        const current = await bot.api.getWebhookInfo();
        if (current.url) throw new Error("A Telegram webhook is already configured. Stop the hosted bot and explicitly remove its webhook before switching to local polling.");
        void bot.start({ onStart: () => console.log("Telegram bot is listening.") })
          .catch(onPollingFailure);
      }
    },
    stop() {
      // Leave the webhook registered during redeploys, so Telegram can retry.
      if (mode === "polling" && bot.isRunning()) return bot.stop();
    },
  };
}
module.exports = { createTelegramTransport };
