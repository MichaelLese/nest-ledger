import { billCards, type Schedule } from '../../../server/bills';
import { monthlySummary } from '../../../server/monthly-summary';
import { getActualSummary } from '../../../server/actual';
import { currentMember, jsonError, privateHeaders } from '../../../server/auth';
import { householdConfig, readMetadata, saveMetadata, readBills } from '../../../server/db';
import { categoryName, leaves, payerHint, parseMetadata, type Summary } from '../../../server/ownership';
import { sameOrigin } from '../../../server/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const member = await currentMember();
    if (!member) return jsonError('Please log in.', 401);
    const summary = await getActualSummary() as Summary & { schedules?: Schedule[] };
    const transactions = leaves(summary.transactions);
    const config = await householdConfig();
    const metadata = new Map((await readMetadata(transactions.map(t => t.id))).map(m => [m.actual_transaction_id, m]));
    const bills = billCards(summary.schedules, await readBills((summary.schedules ?? []).map(s => s.id)), summary.accounts);
    return Response.json({ member, ...config, bills, summary: monthlySummary(summary, [...metadata.values()]), transactions: transactions.map(t => {
      const account = summary.accounts.find(a => a.id === t.account)?.name ?? 'Unknown account';
      return { id: t.id, date: t.date, amount: t.amount, transfer_id: t.transfer_id, description: summary.payees?.find(p => p.id === t.payee)?.name || t.notes || 'Transaction', account, categoryName: categoryName(t, summary.categories), parentId: t.parent_id ?? null,
        payerHint: payerHint(account), metadata: metadata.get(t.id) ?? { actual_transaction_id: t.id, expense_owner: null, payer: null, split_rule: null, notes: null, review_status: 'NEEDS_REVIEW' } };
    }) }, { headers: privateHeaders });
  } catch { return jsonError('Unable to load transactions. Check Actual and household database configuration.', 503); }
}
export async function PUT(request: Request) {
  if (!sameOrigin(request)) return jsonError('Invalid request origin.', 403);
  try {
    if (!await currentMember()) return jsonError('Please log in.', 401);
    if (Number(request.headers.get('content-length')) > 8192) return jsonError('Request too large.', 413);
    const config = await householdConfig();
    let metadata;
    try { metadata = parseMetadata(await request.json(), config.rules); }
    catch (error) { return jsonError(error instanceof Error ? error.message : 'Invalid metadata.', 400); }
    const summary = await getActualSummary() as Summary;
    if (!leaves(summary.transactions).some(t => t.id === metadata.actual_transaction_id)) return jsonError('Transaction is no longer in the current month. Refresh the list.', 409);
    await saveMetadata(metadata);
    return Response.json({ metadata }, { headers: privateHeaders });
  } catch { return jsonError('Unable to save metadata. Check Actual and household database configuration.', 503); }
}
