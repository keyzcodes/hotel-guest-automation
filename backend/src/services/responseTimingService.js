const { performance } = require('node:perf_hooks');

// Measure backend processing only. Provider delivery/read receipts and browser
// rendering are separate milestones; a successful send is not proof of reading.
function createResponseTiming({ clock = () => performance.now(), logger = row => console.info('Guest response timing:', JSON.stringify(row)) } = {}) {
  const started = clock();
  const stages = [];
  let outcome = 'processed', finished = false;
  return {
    setOutcome(value) { outcome = value; },
    async measure(stage, operation) {
      const begin = clock();
      let result = 'ok';
      try { return await operation(); }
      catch (error) { result = 'error'; throw error; }
      finally { stages.push({ stage, elapsedMs: Math.round(clock() - begin), result }); }
    },
    finish(messageId) {
      if (finished) return;
      finished = true;
      // Logging failures must never interrupt saving or replying to a guest.
      try { logger({ messageId: messageId ? String(messageId) : null, outcome, totalMs: Math.round(clock() - started), stages }); }
      catch { /* Telemetry is observational, not a business operation. */ }
    },
  };
}
module.exports = { createResponseTiming };
