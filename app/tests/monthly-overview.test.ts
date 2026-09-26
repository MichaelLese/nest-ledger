import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CategorySpending, OwnershipScopePicker } from '../src/app/category-spending';
import { donutPath, donutSlices } from '../src/app/category-chart';

type Props = ComponentProps<typeof CategorySpending>;
const row = (id: string, owner: Props['data']['transactions'][number]['metadata']['expense_owner'], amount: number, category: string | null = id) => ({
  id, date: '2026-09-01', amount, category, categoryName: 'Food', description: id,
  account: 'Michael Checking', parentId: null, payerHint: 'MICHAEL' as const,
  metadata: { actual_transaction_id: id, expense_owner: owner, payer: 'MICHAEL' as const, split_rule: null, notes: null, review_status: 'REVIEWED' as const },
});
const data: Props['data'] = {
  bills: [], rules: [], defaultSplit: null, currency: 'USD',
  summary: { from: '2026-09-01', through: '2026-09-14', owners: { MICHAEL: 0, LIZ: 0, JOINT: 0, UNCLASSIFIED: 0 }, topCategories: [{ id: 'stale', name: 'Stale', amount: 9999 }] },
  transactions: [row('m', 'MICHAEL', -101), row('l', 'LIZ', -202), row('j', 'JOINT', -303), row('u', null, -404), row('refund', 'LIZ', 1000), { ...row('transfer', 'LIZ', -1000), transfer_id: 'other' }],
};
const render = (props: Partial<Props> = {}) => renderToStaticMarkup(createElement(CategorySpending, { data, scope: [], showAll: false, onShowAll: () => {}, view: 'donut', onView: () => {}, detail: null, onDetail: () => {}, ...props }));
test('scoped view and center use saved owners and full scope denominator', () => {
  const html = render({ scope: ['MICHAEL', 'JOINT'] });
  assert.match(html, /MICHAEL \+ JOINT/);
  assert.match(html, /Spent this month<\/span><strong>\$4.04/);
  assert.match(html, /Open Food details, \$3.03, 75% of active scope/);
  assert.doesNotMatch(html, /Stale|\$10.00/);
  assert.match(html, /role="status">Selected Food/);
});
test('Top 8 is exact and all nonzero categories is independently available', () => {
  const many = { ...data, transactions: Array.from({ length: 10 }, (_, i) => row(String(i), 'LIZ', -(i + 1) * 100)) };
  const top = render({ data: many });
  assert.equal((top.match(/class="category-row"/g) ?? []).length, 8);
  assert.match(top, /Top 8 of 10 categories · \$3.00 outside Top 8/);
  assert.match(top, /\$10.00, 18.2% of active scope/);
  assert.equal((render({ data: many, showAll: true }).match(/class="category-row"/g) ?? []).length, 10);
});
test('ranked list has category detail buttons, no donut dependency or primary row transaction counts', () => {
  const html = render({ view: 'list', scope: ['LIZ'] });
  assert.doesNotMatch(html, /<svg|transactions/);
  assert.match(html, /aria-label="Open Food details, \$2.02, 100% of active scope"/);
  assert.match(render({ scope: ['LIZ'], data: { ...data, transactions: [] } }), /No spending this month for liz/);
});
test('detail includes only gross spending for the exact category ID and owner combination', () => {
  const html = render({ scope: ['MICHAEL', 'JOINT'], detail: { id: 'j', name: 'Food' } });
  assert.match(html, /Six-month history/);
  assert.match(html, /1 transaction/);
  assert.match(html, /<strong>j<\/strong>/);
  assert.doesNotMatch(html, /<strong>m<\/strong>|<strong>l<\/strong>|<strong>refund<\/strong>/);
});
test('selection controls expose each member toggle and clear all-household state', () => {
  const html = renderToStaticMarkup(createElement(OwnershipScopePicker, { scope: ['MICHAEL', 'LIZ'], onChange: () => {} }));
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 2);
  assert.match(html, /aria-pressed="false">All household/);
  assert.match(renderToStaticMarkup(createElement(OwnershipScopePicker, { scope: [], onChange: () => {} })), /includes unclassified expenses/);
});
test('slice geometry preserves full-scope percentages and selected midpoint rotates to bottom', () => {
  const slices = donutSlices([{ id: 'a', name: 'A', amount: 20 }, { id: 'b', name: 'B', amount: 30 }], 100);
  assert.deepEqual(slices.map(row => [row.start, row.sweep]), [[0, 72], [72, 108]]);
  for (const slice of slices) assert.equal(slice.middle + (180 - slice.middle), 180);
  assert.equal((donutPath(0, 360).match(/A /g) ?? []).length, 4);
  assert.doesNotMatch(donutPath(0, 360), /NaN|Infinity/);
});
