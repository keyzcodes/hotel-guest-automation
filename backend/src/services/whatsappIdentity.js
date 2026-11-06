// Phone identity is resolved by the backend, never by model output or room claims.
function normalizePhone(value) {
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value)) return null;
  let digits = value.replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^0[789]\d{9}$/.test(digits)) digits = '234' + digits.slice(1);
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}
function phoneJid(value) {
  const phone = normalizePhone(value);
  return phone ? phone + '@s.whatsapp.net' : null;
}
function senderJid(key) {
  if (key.fromMe || !/^[^@]+@(s\.whatsapp\.net|lid)$/.test(key.remoteJid || '')) return null;
  for (const jid of [key.remoteJidAlt, key.remoteJid]) {
    const match = /^([1-9]\d{7,14})(?::\d+)?@s\.whatsapp\.net$/.exec(jid || '');
    if (match) return match[1] + '@s.whatsapp.net';
  }
  return null; // Unresolved LID is not a phone number.
}
module.exports = { normalizePhone, phoneJid, senderJid };
