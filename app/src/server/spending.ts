import { leaves, members, type Member, type Metadata, type Summary } from './ownership';
import { monthRange } from './month-range';

export type CategorySpend = { id: string | null; name: string; amount: number };
export type OwnershipScope = readonly Member[];
export function inScope(owner: Member | null, scope: OwnershipScope) {
  return scope.length === 0 || owner !== null && scope.includes(owner);
}
export function toggleOwner(scope: OwnershipScope, owner: Member): Member[] {
  return members.filter(member => member === owner ? !scope.includes(member) : scope.includes(member));
}
export function scopeLabel(scope: OwnershipScope) {
  return scope.length ? members.filter(member => scope.includes(member)).join(' + ') : 'All household';
}
export function isSpend(row: { date: string; amount: number; transfer_id?: string | null }, range: { from: string; through: string }) {
  return row.date >= range.from && row.date <= range.through && row.amount < 0 && !row.transfer_id;
}
export function spendingSummary(actual: Summary, metadata: Metadata[], range: { from: string; through: string }, scope: OwnershipScope = []) {
  const owners: Record<Member | 'UNCLASSIFIED', number> = { MICHAEL: 0, LIZ: 0, JOINT: 0, UNCLASSIFIED: 0 };
  const tags = new Map(metadata.map(row => [row.actual_transaction_id, row.expense_owner]));
  const categories = new Map<string | null, CategorySpend>();
  const names = new Map(actual.categories.map(category => [category.id, category.name]));
  for (const row of leaves(actual.transactions)) {
    const owner = tags.get(row.id) ?? null;
    if (!isSpend(row, range) || !inScope(owner, scope)) continue;
    const amount = -row.amount;
    owners[owner ?? 'UNCLASSIFIED'] += amount;
    const id = row.category || null;
    const category = categories.get(id) ?? { id, name: id ? names.get(id) || 'Unknown category' : 'Uncategorized', amount: 0 };
    category.amount += amount;
    categories.set(id, category);
  }
  return { owners, total: Object.values(owners).reduce((sum, amount) => sum + amount, 0), categories: [...categories.values()]
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name) || (a.id ?? '').localeCompare(b.id ?? '')) };
}

export function historyRanges(month: string, today = new Date().toISOString().slice(0, 10)) {
  const selected = monthRange(month, today);
  if (month > today.slice(0, 7)) throw new Error('Month cannot be in the future.');
  const date = new Date(selected.from + 'T00:00:00Z');
  const ranges = [];
  for (let i = 0; i < 6; i++) {
    if (date.getUTCFullYear() < 1) break;
    ranges.unshift(monthRange(date.toISOString().slice(0, 7), today));
    date.setUTCMonth(date.getUTCMonth() - 1);
  }
  return ranges;
}
export function categoryHistory(actual: Summary, metadata: Metadata[], ranges: ReturnType<typeof historyRanges>, category: string | null, scope: OwnershipScope) {
  return ranges.map(range => ({ ...range, amount: spendingSummary(actual, metadata, range, scope).categories.find(row => row.id === category)?.amount ?? 0 }));
}
export type HistoryBar = ReturnType<typeof categoryHistory>[number];
