import { currentMember, jsonError, privateHeaders } from '../../../../server/auth';
import { getActualSummary } from '../../../../server/actual';
import { readMetadata } from '../../../../server/db';
import { leaves, members, type Member, type Summary } from '../../../../server/ownership';
import { categoryHistory, historyRanges } from '../../../../server/spending';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    if (!await currentMember()) return jsonError('Please log in.', 401);
    let ranges, category, scope;
    try {
      const params = new URL(request.url).searchParams;
      if (params.getAll('month').length !== 1 || params.getAll('category').length !== 1) throw new Error('Provide one month and one category.');
      ranges = historyRanges(params.get('month')!);
      category = params.get('category')!;
      if (category.length > 200) throw new Error('Invalid category.');
      scope = params.getAll('owner') as Member[];
      if (scope.some(owner => !members.includes(owner)) || new Set(scope).size !== scope.length) throw new Error('Invalid expense owners.');
    } catch (error) { return jsonError((error as Error).message, 400); }
    // One isolated Actual read for six calendar months; no metadata or ledger writes.
    const range = { from: ranges[0].from, through: ranges.at(-1)!.through };
    const actual = await getActualSummary(range) as Summary;
    const transactions = leaves(actual.transactions).filter(row => row.date >= range.from && row.date <= range.through);
    const metadata = await readMetadata(transactions.map(row => row.id));
    return Response.json({ bars: categoryHistory({ ...actual, transactions }, metadata, ranges, category || null, scope) }, { headers: privateHeaders });
  } catch { return jsonError('Unable to load category history. Try again.', 503); }
}
