import { getActualSummary } from '../../../../server/actual';
import { currentMember, jsonError, privateHeaders } from '../../../../server/auth';
import { billCards, parseBillMetadata, type Schedule } from '../../../../server/bills';
import { saveBills } from '../../../../server/db';
import { sameOrigin } from '../../../../server/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return jsonError('Invalid request origin.', 403);
  try {
    if (!await currentMember()) return jsonError('Please log in.', 401);
    if (Number(request.headers.get('content-length')) > 8192) return jsonError('Request too large.', 413);
    let metadata;
    try { metadata = parseBillMetadata(await request.json()); }
    catch (error) { return jsonError(error instanceof Error ? error.message : 'Invalid bill metadata.', 400); }
    const summary = await getActualSummary() as { schedules?: Schedule[] };
    const schedule = billCards(summary.schedules).find(row => row.actual_schedule_id === metadata.actual_schedule_id);
    if (!schedule) return jsonError('Schedule is no longer available in Actual. Refresh the list.', 409);
    await saveBills(metadata, schedule.name);
    return Response.json({ metadata }, { headers: privateHeaders });
  } catch { return jsonError('Unable to save bill metadata. Check Actual and household database configuration.', 503); }
}
