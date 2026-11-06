function whatsapp() { return process.env.GUEST_CHANNEL === 'WHATSAPP'; }
function field() { return whatsapp() ? 'whatsappJid' : 'telegramChatId'; }
function channel() { return whatsapp() ? 'WHATSAPP' : 'TELEGRAM'; }
function address(booking) { return booking[field()]; }
function sendStaffReply(...args) {
  return require(whatsapp() ? './whatsappService' : './telegramService').sendStaffReply(...args);
}
module.exports = { whatsapp, field, channel, address, sendStaffReply };
