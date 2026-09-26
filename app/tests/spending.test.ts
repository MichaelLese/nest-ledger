import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryHistory, historyRanges, inScope, spendingSummary, toggleOwner } from '../src/server/spending';
import { members, type Metadata, type Summary } from '../src/server/ownership';

const actual: Summary = { accounts: [], categories: [{ id: 'a', name: 'Food', hidden: true }, { id: 'b', name: 'Food' }], transactions: [
  { id: 'm', date: '2026-09-01', amount: -100, category: 'a', account: 'Liz checking' },
  { id: 'l', date: '2026-09-02', amount: -200, category: 'b', account: 'Michael checking' },
  { id: 'j', date: '2026-09-03', amount: -300, category: 'a', account: 'Michael checking' },
  { id: 'u', date: '2026-09-03', amount: -400, category: null, account: 'Michael checking' },
  { id: 'old', date: '2026-04-01', amount: -500, category: 'a', account: 'Liz checking' },
  { id: 'refund', date: '2026-09-03', amount: 100, category: 'a', account: 'Liz checking' },
  { id: 'transfer', date: '2026-09-03', amount: -1000, category: 'a', account: 'Liz checking', transfer_id: 'x' },
] };
const metadata: Metadata[] = ['m', 'l', 'j', 'old', 'refund', 'transfer'].map((id, i) => ({ actual_transaction_id: id, expense_owner: members[i % 3], payer: 'JOINT', split_rule: null, notes: null, review_status: 'REVIEWED' }));
const range = { from: '2026-09-01', through: '2026-09-26' };
test('all eight owner combinations scope every amount by saved expense owner, independent of payer/account', () => {
  for (let mask = 0; mask < 8; mask++) {
    const scope = members.filter((_, i) => mask & (1 << i));
    const result = spendingSummary(actual, metadata, range, scope);
    assert.equal(result.total, mask === 0 ? 1000 : members.reduce((sum, owner, i) => sum + (scope.includes(owner) ? (i + 1) * 100 : 0), 0));
    assert.equal(result.categories.reduce((sum, row) => sum + row.amount, 0), result.total);
    assert.equal(result.owners.UNCLASSIFIED, mask === 0 ? 400 : 0);
    assert.equal(inScope(null, scope), mask === 0);
  }
  assert.deepEqual(spendingSummary(actual, metadata, range, ['MICHAEL', 'LIZ']).categories, [{ id: 'b', name: 'Food', amount: 200 }, { id: 'a', name: 'Food', amount: 100 }]);
});
test('owner toggles add/remove independently and last removal restores all household', () => {
  assert.deepEqual(toggleOwner([], 'LIZ'), ['LIZ']);
  assert.deepEqual(toggleOwner(['LIZ'], 'MICHAEL'), ['MICHAEL', 'LIZ']);
  assert.deepEqual(toggleOwner(['MICHAEL', 'LIZ'], 'MICHAEL'), ['LIZ']);
  assert.deepEqual(toggleOwner(['LIZ'], 'LIZ'), []);
});
test('six-month category history uses ID, scoped owners, zeros, full past months and current month to date', () => {
  const ranges = historyRanges('2026-09', '2026-09-26');
  assert.equal(ranges.length, 6);
  assert.deepEqual(ranges[0], { from: '2026-04-01', through: '2026-04-30' });
  assert.deepEqual(ranges[5], range);
  assert.deepEqual(categoryHistory(actual, metadata, ranges, 'a', ['MICHAEL', 'JOINT']).map(row => row.amount), [500, 0, 0, 0, 0, 400]);
  assert.deepEqual(categoryHistory(actual, metadata, ranges, 'b', ['MICHAEL', 'JOINT']).map(row => row.amount), [0, 0, 0, 0, 0, 0]);
  assert.equal(categoryHistory(actual, metadata, ranges, null, []).at(-1)?.amount, 400);
  assert.equal(historyRanges('2024-03', '2026-09-26')[4].through, '2024-02-29');
  assert.equal(historyRanges('2024-03', '2026-09-26')[0].from, '2023-10-01');
  assert.equal(historyRanges('0001-01', '2026-09-26').length, 1);
  assert.throws(() => historyRanges('2026-10', '2026-09-26'), /future/);
});
test('all nonzero categories stay available beyond exact top eight, with deterministic ID ties', () => {
  const many = { ...actual, transactions: Array.from({ length: 10 }, (_, i) => ({ ...actual.transactions[0], id: String(i), category: String(i), amount: -100 })) };
  assert.deepEqual(spendingSummary(many, [], range).categories.map(row => row.id), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
});
