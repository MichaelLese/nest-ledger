import { createHmac, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export type LoginMember = 'MICHAEL' | 'LIZ';
export const cookieName = 'nest_session';
export const sessionSeconds = 60 * 60 * 12;
function secret() {
  const value = process.env.AUTH_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('Auth not configured');
  return value;
}
export function signSession(member: LoginMember, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ member, expires: Math.floor(now / 1000) + sessionSeconds })).toString('base64url');
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`;
}
export function verifySession(token: string | undefined, now = Date.now()): LoginMember | null {
  if (!token || token.length > 1024) return null;
  try {
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra) return null;
    const expected = createHmac('sha256', secret()).update(body).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return ['MICHAEL', 'LIZ'].includes(data.member) && Number.isSafeInteger(data.expires) && data.expires > Math.floor(now / 1000) ? data.member : null;
  } catch { return null; }
}
export async function checkPassword(member: LoginMember, password: string) {
  secret();
  const encoded = process.env[`AUTH_${member}_PASSWORD_HASH`] || '';
  const [salt, hash] = encoded.split(':');
  if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hash || '')) throw new Error('Auth not configured');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}
export function sameOrigin(request: Request) {
  const configured = process.env.AUTH_ORIGIN;
  return !!configured && request.headers.get('origin') === configured;
}
