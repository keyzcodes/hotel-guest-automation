import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function sessionCodec(hex, json) {
  if (!/^[a-f0-9]{64}$/i.test(hex ?? '')) throw Error('LAB_SESSION_KEY must be 64 hex characters.');
  const key = Buffer.from(hex, 'hex');
  return {
    seal(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(value, json.replacer)), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    },
    open(value) {
      const bytes = Buffer.from(value, 'base64');
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(), json.reviver);
    }
  };
}
