import { NextResponse } from 'next/server';
import { db } from '../../../../server/db';
import { checkPassword, cookieName, sameOrigin, sessionSeconds, signSession } from '../../../../server/session';
import { jsonError, privateHeaders } from '../../../../server/auth';
export const runtime = 'nodejs';
// Household-wide per-member throttle; bounded to two entries, reset on process restart.
const attempts = new Map<string, { count: number; until: number }>();
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError('Invalid request origin.', 403);
  try {
    if (Number(request.headers.get('content-length')) > 4096) return jsonError('Request too large.', 413);
    const { member, password } = await request.json();
    if (!['MICHAEL', 'LIZ'].includes(member) || typeof password !== 'string' || password.length > 1024) return jsonError('Invalid login.', 400);
    const now = Date.now();
    let entry = attempts.get(member);
    if (!entry || now >= entry.until) { entry = { count: 0, until: now + 15 * 60_000 }; attempts.set(member, entry); }
    if (entry.count >= 10) return jsonError('Too many login attempts. Try again in 15 minutes.', 429);
    entry.count++;
    if (!await checkPassword(member, password)) return jsonError('Incorrect member or password.', 401);
    const result = await db.query('SELECT type FROM household_members WHERE type = $1', [member]);
    if (result.rows.length !== 1) return jsonError('Login unavailable.', 503);
    attempts.delete(member);
    const response = NextResponse.json({ member }, { headers: privateHeaders });
    response.cookies.set(cookieName, signSession(member), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: sessionSeconds });
    return response;
  } catch { return jsonError('Login unavailable. Check application configuration.', 503); }
}
