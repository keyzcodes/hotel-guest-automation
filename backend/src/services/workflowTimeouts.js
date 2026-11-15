// Shared resolution keeps startup diagnostics and AI execution in agreement.
function resolve(setting, fallback, integerOnly = false) {
  const value = Number(setting);
  const valid = Number.isFinite(value) && value >= 1000 && value <= 20000 &&
    (!integerOnly || Number.isInteger(value));
  return { timeoutMs: valid ? Math.floor(value) : fallback,
    source: valid ? 'configured' : (setting === undefined || setting === '' ? 'default' : 'invalid_using_default') };
}
function aiTimeouts(env = process.env) {
  return {
    preStay: resolve(env.WHATSAPP_PRE_STAY_TIMEOUT_MS, 12000, true),
    inStay: resolve(env.AI_RESPONSE_TIMEOUT_MS, 8000),
  };
}
function startupDiagnostics(env = process.env) {
  return {
    ...aiTimeouts(env),
    preStayPath: env.WHATSAPP_ENQUIRY_AGENT_ENABLED === 'true' ? 'enquiry_agent_when_workflow_available' : env.WHATSAPP_BOOKING_WORKFLOW_ENABLED === 'true' && env.WHATSAPP_AVAILABILITY_TOOL_DEMO === 'true'
      ? 'availability_tool_when_workflow_available' : 'structured_conversation',
    availabilityToolMaxRetries: 2,
    enquiryAgentMaxSteps: 6,
    retriesShareAiBudget: true,
    endToEndDeadlineMs: null,
    // Existing transport/database constants; these are not per-query limits.
    mongoServerSelectionMs: 15000, sessionMongoServerSelectionMs: 10000,
    conversationSendDeadlineMs: null,
    queuedSendDeadlineMs: 20000, scheduledStaySendDeadlineMs: 25000,
  };
}
module.exports = { aiTimeouts, startupDiagnostics };
