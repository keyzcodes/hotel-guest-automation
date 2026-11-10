// libsignal writes these directly to the console, bypassing Baileys' logger.
const guarded = new WeakSet();
const sessionLogs = new Set(['Closing session:', 'Opening session:', 'Removing old closed session:', 'Session already closed']);

function installWhatsAppSessionLogGuard(logger = console) {
  if (guarded.has(logger)) return;
  guarded.add(logger);
  for (const level of ['info', 'warn']) {
    const log = logger[level].bind(logger);
    logger[level] = (label, ...details) => {
      if (sessionLogs.has(label)) return;
      log(label, ...details);
    };
  }
}

module.exports = { installWhatsAppSessionLogGuard };
