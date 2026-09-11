export const members = ['MICHAEL', 'LIZ', 'JOINT'] as const;
export type Member = typeof members[number];
export type Metadata = { actual_transaction_id: string; expense_owner: Member | null; payer: Member | null; split_rule: string | null; notes: string | null; review_status: 'NEEDS_REVIEW' | 'REVIEWED' };
export type SplitRule = { id: string; name: string; me_percentage: string; wife_percentage: string };
export type Transaction = { id: string; account: string; date: string; amount: number; payee?: string; transfer_id?: string | null; category?: string | null; notes?: string; is_parent?: boolean; parent_id?: string; subtransactions?: Transaction[] };
export type Summary = { categories: { id: string; name: string; hidden?: boolean }[]; payees?: { id: string; name: string }[]; accounts: { id: string; name: string }[]; transactions: Transaction[] };
export function categoryName(transaction: Transaction, categories: Summary['categories']): string | null {
  return categories.find(category => category.id === transaction.category)?.name || null;
}
export function payerHint(name: string): Member | null {
  const match = /^(Michael|Liz|Joint)(?=$|[\s:._-])/i.exec(name.trim());
  return match ? match[1].toUpperCase() as Member : null;
}
// Only leaf transactions are classifiable; preserve each Actual split child's ID.
export function leaves(transactions: Transaction[]): Transaction[] {
  const result = new Map<string, Transaction>();
  function visit(t: Transaction, parent?: Transaction) {
    const row = { ...parent, ...t, subtransactions: t.subtransactions };
    if (t.subtransactions?.length) t.subtransactions.forEach(child => visit(child, row));
    else if (!t.is_parent) result.set(t.id, row);
  }
  transactions.forEach(t => visit(t));
  return [...result.values()];
}
export function parseMetadata(value: unknown, rules: SplitRule[]): Metadata {
  if (!value || typeof value !== 'object') throw new Error('Invalid metadata.');
  const v = value as Record<string, unknown>;
  const member = (x: unknown) => x === null || members.includes(x as Member);
  if (typeof v.actual_transaction_id !== 'string' || !v.actual_transaction_id.trim() || v.actual_transaction_id.length > 200
    || !member(v.expense_owner) || !member(v.payer)
    || !['NEEDS_REVIEW', 'REVIEWED'].includes(v.review_status as string)
    || !(v.notes === null || typeof v.notes === 'string' && v.notes.length <= 2000)) throw new Error('Invalid metadata.');
  if (v.review_status === 'REVIEWED' && (!v.expense_owner || !v.payer)) throw new Error('Choose an expense owner and payer before confirming review.');
  if (v.expense_owner === 'JOINT') {
    if (!rules.some(rule => rule.id === v.split_rule)) throw new Error('Choose a joint split rule.');
  } else if (v.split_rule !== null) throw new Error('Only joint expenses can have a split rule.');
  return { actual_transaction_id: v.actual_transaction_id, expense_owner: v.expense_owner as Member | null, payer: v.payer as Member | null, split_rule: v.split_rule as string | null, notes: v.notes as string | null, review_status: v.review_status as Metadata['review_status'] };
}
export function allocate(amount: number, rule: SplitRule) {
  const points = Math.round(Number(rule.me_percentage) * 100);
  if (!Number.isSafeInteger(amount) || !Number.isInteger(points) || points < 0 || points > 10000 || Math.round(Number(rule.wife_percentage) * 100) + points !== 10000) throw new Error('Invalid split.');
  const michael = Number((BigInt(Math.abs(amount)) * BigInt(points) + 5000n) / 10000n) * Math.sign(amount);
  return { MICHAEL: michael, LIZ: amount - michael };
}
