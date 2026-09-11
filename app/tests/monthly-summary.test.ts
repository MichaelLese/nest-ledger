import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlySummary } from '../src/server/monthly-summary';
import type { Metadata, Summary, Transaction } from '../src/server/ownership';
const through = '2026-09-11';
const transaction = (id: string, amount: number, category: string | null = 'food'): Transaction => ({ id, amount, category, account: 'Michael Checking', date: '2026-09-01' });
const tag = (id: string, owner: Metadata['expense_owner']): Metadata => ({ actual_transaction_id: id, expense_owner: owner, payer: 'LIZ', split_rule: null, notes: null, review_status: 'NEEDS_REVIEW' });
const actual = (transactions: Transaction[]): Summary => ({ transactions, accounts: [], categories: [{ id: 'food', name: 'Food' }, { id: 'home', name: 'Home', hidden: true }] });
test('empty month and empty tags give zero owner totals and a separate unclassified bucket', () => {
  assert.deepEqual(monthlySummary(actual([]), [], through), { from: '2026-09-01', through, owners: { MICHAEL: 0, LIZ: 0, JOINT: 0, UNCLASSIFIED: 0 }, topCategories: [] });
  assert.deepEqual(monthlySummary(actual([transaction('a', -101), transaction('b', -200)]), [], through).owners, { MICHAEL: 0, LIZ: 0, JOINT: 0, UNCLASSIFIED: 301 });
});
test('saved owners count independently of payer and review status; null and missing tags stay unclassified', () => {
  const rows = [transaction('a', -101), transaction('b', -202), transaction('c', -303)];
  const tags = [tag('a', 'MICHAEL'), tag('b', 'LIZ'), { ...tag('c', 'JOINT'), review_status: 'REVIEWED' as const }];
  assert.deepEqual(monthlySummary(actual(rows), tags, through).owners, { MICHAEL: 101, LIZ: 202, JOINT: 303, UNCLASSIFIED: 0 });
  assert.equal(monthlySummary(actual([...rows, transaction('d', -7), transaction('e', -8)]), [...tags, tag('d', null), tag('stale', 'MICHAEL')], through).owners.UNCLASSIFIED, 15);
});
test('split children count once using their own owners and categories', () => {
  const children = [transaction('a', -101), transaction('b', -202, 'home')].map(row => ({ ...row, parent_id: 'parent' }));
  const parent = { ...transaction('parent', -303), is_parent: true, subtransactions: children };
  for (const rows of [[parent], [parent, ...children], children]) {
    const result = monthlySummary(actual(rows), [tag('parent', 'JOINT'), tag('a', 'MICHAEL')], through);
    assert.deepEqual(result.owners, { MICHAEL: 101, LIZ: 0, JOINT: 0, UNCLASSIFIED: 202 });
    assert.deepEqual(result.topCategories, [{ id: 'home', name: 'Home', amount: 202 }, { id: 'food', name: 'Food', amount: 101 }]);
  }
});
test('spending excludes income, refunds, zero, linked transfers and dates outside UTC month to date', () => {
  const rows = [transaction('expense', -101), transaction('refund', 10), transaction('income', 10000), transaction('zero', 0), { ...transaction('transfer', -500), transfer_id: 'other-side' }, { ...transaction('old', -100), date: '2026-08-31' }, { ...transaction('future', -100), date: '2026-09-12' }, { ...transaction('today', -9), date: through }];
  assert.equal(monthlySummary(actual(rows), [], through).owners.UNCLASSIFIED, 110);
});
test('categories aggregate by ID across owners, sort by spend and deterministic ties, limit to eight', () => {
  const rows = [transaction('a', -100), transaction('b', -200), transaction('c', -300, 'home'), transaction('d', -5, null), transaction('e', -6, 'missing')];
  const result = monthlySummary(actual(rows), [tag('a', 'MICHAEL'), tag('b', 'LIZ')], through);
  assert.deepEqual(result.topCategories, [{ id: 'food', name: 'Food', amount: 300 }, { id: 'home', name: 'Home', amount: 300 }, { id: 'missing', name: 'Unknown category', amount: 6 }, { id: null, name: 'Uncategorized', amount: 5 }]);
  const many = monthlySummary(actual(Array.from({ length: 10 }, (_, i) => transaction(String(i), -(i + 1), String(i)))), [], through);
  assert.deepEqual(many.topCategories.map(row => row.amount), [10, 9, 8, 7, 6, 5, 4, 3]);
});
