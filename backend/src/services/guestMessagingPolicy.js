// Development may inspect guest records without operating the hosted bot.
const enabled = () => process.env.GUEST_MESSAGING_ENABLED !== 'false';
function rejectDisabledSends(req, res, next) {
  if (enabled()) return next();
  const sends = (req.method === 'POST' && /^\/conversations\/[^/]+\/reply\/?$/.test(req.path)) ||
    (req.method === 'PATCH' && /^\/tasks\/[^/]+\/?$/.test(req.path) && req.body?.status === 'Resolved');
  if (sends) return res.status(409).json({ success: false, message: 'Guest messaging is disabled in this development session.' });
  next();
}
module.exports = { enabled, rejectDisabledSends };
