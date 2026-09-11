import { leaves, type Member, type Metadata, type Summary } from './ownership';

export function monthlySummary(actual: Summary, metadata: Metadata[], through = new Date().toISOString().slice(0, 10)) {
  const from = through.slice(0, 8) + '01';
  const owners: Record<Member | 'UNCLASSIFIED', number> = { MICHAEL: 0, LIZ: 0, JOINT: 0, UNCLASSIFIED: 0 };
  const tags = new Map(metadata.map(row => [row.actual_transaction_id, row.expense_owner]));
  const categories = new Map<string | null, { id: string | null; name: string; amount: number }>();
  const names = new Map(actual.categories.map(category => [category.id, category.name]));
  // Gross spending: income/refunds and linked transfers are not expenses.
  for (const row of leaves(actual.transactions)) {
    if (row.date < from || row.date > through || row.amount >= 0 || row.transfer_id) continue;
    const amount = -row.amount;
    owners[tags.get(row.id) ?? 'UNCLASSIFIED'] += amount;
    const id = row.category || null;
    const category = categories.get(id) ?? { id, name: id ? names.get(id) || 'Unknown category' : 'Uncategorized', amount: 0 };
    category.amount += amount;
    categories.set(id, category);
  }
  return { from, through, owners, topCategories: [...categories.values()]
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name) || (a.id ?? '').localeCompare(b.id ?? ''))
    .slice(0, 8) };
}

export type MonthlySummary = ReturnType<typeof monthlySummary>;
