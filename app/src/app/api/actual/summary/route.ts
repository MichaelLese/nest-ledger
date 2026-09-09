import { getActualSummary } from '../../../../server/actual';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    return Response.json(await getActualSummary(), { headers });
  } catch (error) {
    const message = error instanceof Error && (error.message.startsWith('Actual ') || error.message.startsWith('ACTUAL_SERVER_URL'))
      ? error.message : 'Actual is unavailable. Check the server configuration.';
    return Response.json({ error: message }, { status: 503, headers });
  }
}
