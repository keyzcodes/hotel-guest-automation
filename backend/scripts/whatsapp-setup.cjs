const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const target = path.join(__dirname, '../.env.whatsapp');
try {
  const [hotelEnv, labEnv] = process.argv.slice(2);
  if (!hotelEnv || !labEnv) throw Error('Pass the hotel backend .env path followed by the standalone lab .env path.');
  if (fs.existsSync(target)) throw Error('.env.whatsapp already exists. It was not overwritten.');
  const hotel = dotenv.parse(fs.readFileSync(hotelEnv));
  const lab = dotenv.parse(fs.readFileSync(labEnv));
  if (!/^mongodb(?:\+srv)?:\/\/[^/]+\/sesora_whatsapp_lab(?:\?|$)/.test(lab.LAB_MONGO_URI || ''))
    throw Error('The lab URI must select sesora_whatsapp_lab.');
  if (!/^[a-f0-9]{64}$/i.test(lab.LAB_SESSION_KEY || '')) throw Error('The lab session key is missing or invalid.');
  if (!hotel.STAFF_EMAIL || !hotel.STAFF_PASSWORD_HASH) throw Error('The hotel .env must have STAFF_EMAIL and STAFF_PASSWORD_HASH for the isolated test login.');
  const settings = {
    MONGO_URI: lab.LAB_MONGO_URI, WHATSAPP_SESSION_KEY: lab.LAB_SESSION_KEY,
    STAFF_EMAIL: hotel.STAFF_EMAIL, STAFF_PASSWORD_HASH: hotel.STAFF_PASSWORD_HASH,
  };
  // The optional existing AI key supports the existing interpreter. With no key,
  // simple housekeeping requests still use the established local fallback.
  if (hotel.GEMINI_API_KEY) settings.GEMINI_API_KEY = hotel.GEMINI_API_KEY;
  else if (hotel.GOOGLE_API_KEY) settings.GOOGLE_API_KEY = hotel.GOOGLE_API_KEY;
  fs.writeFileSync(target, Object.entries(settings).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Created local .env.whatsapp. No credentials printed or original files changed.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
