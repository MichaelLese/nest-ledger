import { NextResponse } from 'next/server';
import { cookieName, sameOrigin } from '../../../../server/session';
import { jsonError, privateHeaders } from '../../../../server/auth';
export async function POST(request: Request) {
  if (!sameOrigin(request)) return jsonError('Invalid request origin.', 403);
  const response = NextResponse.json({ ok: true }, { headers: privateHeaders });
  response.cookies.set(cookieName, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
