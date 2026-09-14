import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MonthlyOverview } from '../src/app/ownership-app';

type Props = ComponentProps<typeof MonthlyOverview>;
const row = (id: string, owner: Props['data']['transactions'][number]['metadata']['expense_owner'], amount: number, category = id) => ({
  id, date: '2026-09-01', amount, category, categoryName: 'Food', description: id,
  account: 'Michael Checking', parentId: null, payerHint: 'MICHAEL' as const,
  metadata: { actual_transaction_id: id, expense_owner: owner, payer: 'MICHAEL' as const, split_rule: null, notes: null, review_status: 'REVIEWED' as const },
});
const data: Props['data'] = {
  bills: [], rules: [], defaultSplit: null, currency: 'USD',
  summary: { from: '2026-09-01', through: '2026-09-14', owners: { MICHAEL: 0, LIZ: 0, JOINT: 0, UNCLASSIFIED: 0 }, topCategories: [{ id: 'overall', name: 'Overall category', amount: 9999 }] },
  transactions: [row('m', 'MICHAEL', -101), row('l', 'LIZ', -202), row('j', 'JOINT', -303), row('u', null, -404), row('refund', 'LIZ', 1000), { ...row('transfer', 'LIZ', -1000), transfer_id: 'other' }],
};
const render = (categoryOwner: Props['categoryOwner'], value = data) => renderToStaticMarkup(createElement(MonthlyOverview, { data: value, categoryOwner, onSelect: () => {} }));
const categories = (html: string) => html.slice(html.indexOf('Top categories'));
test('member categories use saved owners, exclude refunds/transfers and show selection', () => {
  for (const [owner, label, amount] of [['MICHAEL', 'MICHAEL', '1.01'], ['LIZ', 'LIZ', '2.02'], ['JOINT', 'JOINT', '3.03'], ['UNCLASSIFIED', 'Unclassified', '4.04']] as const) {
    const html = render(owner);
    assert.match(categories(html), new RegExp(label + ' · up to 8'));
    assert.ok(categories(html).includes('$' + amount));
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.ok(!categories(html).includes('Overall category'));
  }
  const overall = render('ALL');
  assert.match(categories(overall), /Overall · up to 8/);
  assert.match(categories(overall), /Overall category/);
  assert.ok(!overall.includes('aria-pressed="true"'));
});
test('selected categories update after saved ownership changes and preserve separate category IDs', () => {
  const changed = { ...data, transactions: [row('a', 'LIZ', -100), row('b', 'LIZ', -200)] };
  assert.equal((categories(render('LIZ', changed)).match(/<li>/g) ?? []).length, 2);
  assert.match(categories(render('MICHAEL', changed)), /No spending this month/);
  changed.transactions[0] = row('a', 'MICHAEL', -100);
  assert.match(categories(render('MICHAEL', changed)), /\$1\.00/);
  assert.ok(!categories(render('LIZ', changed)).includes('$1.00'));
});
test('clicking a member selects it and clicking the active member restores overall', () => {
  for (const active of ['ALL', 'MICHAEL', 'LIZ', 'JOINT', 'UNCLASSIFIED'] as const) {
    let selected: Props['categoryOwner'] = active;
    const view = MonthlyOverview({ data, categoryOwner: active, onSelect: owner => { selected = owner; } });
    const cards = view.props.children.find((child: { props?: { className?: string } }) => child?.props?.className === 'summary-cards');
    for (const card of cards.props.children) {
      card.props.onClick();
      assert.equal(selected, card.key === active ? 'ALL' : card.key);
    }
  }
});
