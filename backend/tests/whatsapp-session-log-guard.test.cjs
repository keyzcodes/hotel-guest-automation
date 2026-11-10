const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installWhatsAppSessionLogGuard } = require('../src/services/whatsappSessionLogGuard');

test('session records are suppressed while regular console messages remain visible', () => {
  const logged = [];
  const logger = { info: (...args) => logged.push(args), warn: (...args) => logged.push(args) };
  installWhatsAppSessionLogGuard(logger);
  const installed = logger.info;
  installWhatsAppSessionLogGuard(logger);
  assert.equal(logger.info, installed);
  for (const label of ['Closing session:', 'Opening session:', 'Removing old closed session:']) {
    logger.info(label, { currentRatchet: { privKey: 'test-only' } });
  }
  logger.warn('Session already closed', { rootKey: 'test-only' });
  logger.info('WhatsApp connected.');
  logger.warn('WhatsApp pre-stay AI fallback:', '{"providerStatus":503}');
  assert.deepEqual(logged, [['WhatsApp connected.'], ['WhatsApp pre-stay AI fallback:', '{"providerStatus":503}']]);
});
