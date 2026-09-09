import { cookies } from 'next/headers';
import { db } from './db';
import { cookieName, verifySession } from './session';
export async function currentMember() {
  const member = verifySession((await cookies()).get(cookieName)?.value);
  if (!member) return null;
  const result = await db.query('SELECT type FROM household_members WHERE type = $1', [member]);
  return result.rows.length === 1 ? member : null;
}
export const privateHeaders = { 'Cache-Control': 'no-store' };
export function jsonError(error: string, status: number) { return Response.json({ error }, { status, headers: privateHeaders }); }
