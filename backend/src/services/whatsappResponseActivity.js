function startResponseActivity({ setTyping, signal, refreshMs = 4000 }) {
  let finished = false;
  let presence = Promise.resolve();
  let refreshTimer;
  const report = error => console.warn('WhatsApp response activity failed:', error?.name || 'Error');

  function updateTyping(typing) {
    // Serialize presence updates so a late composing update cannot follow paused.
    // Presence failures never block the guest's actual reply.
    presence = presence.then(() => {
      if (typing && finished) return;
      return setTyping(typing);
    }).catch(report);
  }

  function cancel() {
    if (finished) return;
    finished = true;
    clearInterval(refreshTimer);
    signal?.removeEventListener('abort', cancel);
    updateTyping(false);
  }

  if (signal?.aborted) {
    finished = true;
  } else {
    signal?.addEventListener('abort', cancel, { once: true });
    updateTyping(true);
    refreshTimer = setInterval(() => updateTyping(true), refreshMs);
  }

  return { finish: cancel };
}

module.exports = { startResponseActivity };
