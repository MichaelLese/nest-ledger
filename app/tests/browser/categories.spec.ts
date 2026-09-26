import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { members } from '../../src/server/ownership';
import { historyRanges } from '../../src/server/spending';
import type { Data } from '../../src/app/ownership-app';

function fixture(month: string): Data {
  const transactions = Array.from({ length: 10 }, (_, i) => ({
    id: `t${i}`, date: `${month}-01`, amount: -(10 - i) * 1000,
    category: `c${i}`, categoryName: i < 2 ? 'Food' : `Category ${i}`, description: `Purchase ${i}`,
    account: 'Joint checking', parentId: i === 0 ? 'split-parent' : null, payerHint: 'JOINT' as const,
    metadata: { actual_transaction_id: `t${i}`, expense_owner: members[i % 3], payer: 'JOINT' as const, split_rule: null, notes: null, review_status: 'REVIEWED' as const },
  }));
  return { currency: 'USD', rules: [], defaultSplit: null, bills: [], summary: { from: `${month}-01`, through: `${month}-28`, owners: { MICHAEL: 0, LIZ: 0, JOINT: 0, UNCLASSIFIED: 0 }, topCategories: [] },
    transactions: [...transactions, { ...transactions[0], id: 'unclassified', amount: -500, category: null, categoryName: null, metadata: { ...transactions[0].metadata, actual_transaction_id: 'unclassified', expense_owner: null } },
      { ...transactions[0], id: 'refund', amount: 300, description: 'Refund excluded' },
      { ...transactions[0], id: 'transfer', amount: -300, description: 'Transfer excluded', transfer_id: 'other' }],
  };
}
async function setup(page: Page, longLabels = false) {
  await page.route('**/api/ownership?*', async route => {
    const month = new URL(route.request().url()).searchParams.get('month')!;
    const data = fixture(month);
    if (longLabels) data.transactions.filter(row => row.category === 'c0').forEach(row => { row.categoryName = 'An exceptionally long category name for household spending'; });
    await route.fulfill({ json: data });
  });
  await page.route('**/api/ownership/category-history?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    await route.fulfill({ json: { bars: historyRanges(params.get('month')!).map((range, i) => ({ ...range, amount: i * 1000 })) } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Spending by category' })).toBeVisible();
}
const scope = (page: Page) => page.getByRole('navigation', { name: 'Expense ownership scope' });

test('default Top 8, combined ownership, last removal and session-only reload behavior', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', req => { if (req.method() !== 'GET') writes.push(req.method()); });
  await setup(page);
  await expect(page.locator('.category-donut')).toBeVisible();
  await expect(page.locator('.category-row')).toHaveCount(8);
  await expect(page.locator('.scope-total')).toContainText('$555.00');
  await scope(page).getByRole('button', { name: 'MICHAEL', exact: true }).click();
  await scope(page).getByRole('button', { name: 'LIZ', exact: true }).click();
  await expect(page.locator('.scope-total')).toContainText('$400.00');
  await expect(scope(page).getByRole('button', { pressed: true })).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: '9 transactions shown' })).toBeVisible();
  await scope(page).getByRole('button', { name: 'MICHAEL', exact: true }).click();
  await scope(page).getByRole('button', { name: 'LIZ', exact: true }).click();
  await expect(scope(page).getByRole('button', { name: 'All household' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'All nonzero categories', exact: true }).click();
  await expect(page.locator('.category-row')).toHaveCount(11);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('.category-row')).toHaveCount(11);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.locator('.category-row')).toHaveCount(11);
  await page.getByRole('button', { name: 'Ranked list', exact: true }).click();
  await page.reload();
  await expect(page.locator('.category-row')).toHaveCount(8);
  await expect(page.locator('.category-donut')).toBeVisible();
  expect(writes).toEqual([]);
});

test('slice rotation, center detail, ID filtering, history scope and back focus', async ({ page }) => {
  await setup(page);
  const slice = page.locator('path[role="button"]').nth(1);
  await slice.focus();
  await page.keyboard.press('Enter');
  await expect(slice).toHaveAttribute('aria-pressed', 'true');
  const transform = await page.locator('.donut-rotation').getAttribute('style');
  expect(Number(/rotate\(([-.0-9]+)/.exec(transform!)![1])).toBeCloseTo(85.945945, 3);
  await page.getByRole('button', { name: 'Open Food details, $90.00', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeFocused();
  await expect(page.locator('.history-bars li')).toHaveCount(6);
  await expect(page.locator('.included-transactions li')).toHaveCount(1);
  await expect(page.locator('.included-transactions')).toContainText('Purchase 1');
  await expect(page.locator('.included-transactions')).not.toContainText('Purchase 0');
  const request = page.waitForRequest(req => req.url().includes('/category-history?') && req.url().includes('owner=MICHAEL'));
  await scope(page).getByRole('button', { name: 'MICHAEL', exact: true }).click();
  expect(new URL((await request).url()).searchParams.get('category')).toBe('c1');
  await expect(page.getByText('No spending transactions match this category and ownership selection.')).toBeVisible();
  await expect(page.locator('.scope-total')).toContainText('$0.00');
  await page.getByRole('button', { name: 'Back to categories', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Spending by category' })).toBeFocused();
});

test('ranked list works by keyboard; history errors are retryable and month changes retain detail', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Ranked list', exact: true }).click();
  await expect(page.locator('.category-donut')).toHaveCount(0);
  await page.route('**/api/ownership/category-history?*', route => route.fulfill({ status: 503, json: { error: 'History unavailable' } }));
  await page.locator('.category-row').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('History unavailable');
  await expect(page.locator('.included-transactions')).toContainText('Purchase 0');
  await expect(page.locator('.included-transactions')).not.toContainText('Refund excluded');
  await page.route('**/api/ownership/category-history?*', async route => {
    const month = new URL(route.request().url()).searchParams.get('month')!;
    await route.fulfill({ json: { bars: historyRanges(month).map(range => ({ ...range, amount: 100 })) } });
  });
  await page.getByRole('button', { name: 'Retry history' }).click();
  await expect(page.locator('.history-bars li')).toHaveCount(6);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.locator('.history-bars li')).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'Food', exact: true })).toBeVisible();
});

test('narrow layout, touch controls, reduced motion and long labels', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page, true);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.locator('.donut-rotation')).toHaveCSS('transition-duration', '0s');
  for (const button of await scope(page).getByRole('button').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.category-panel').screenshot({ path: `.validation/${testInfo.project.name}-overview.png` });
  await page.locator('.donut-center').click();
  await expect(page.locator('.history-bars li')).toHaveCount(6);
  const tracks = await page.locator('.history-bar-track').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
  expect(Math.max(...tracks) - Math.min(...tracks)).toBeLessThan(1);
  await page.locator('.category-panel').screenshot({ path: `.validation/${testInfo.project.name}-detail.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('accessible overview, list and detail have no automated WCAG AA violations', async ({ page }) => {
  await setup(page);
  const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect((await scan()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Ranked list', exact: true }).click();
  expect((await scan()).violations).toEqual([]);
  await page.locator('.category-row').first().click();
  await expect(page.locator('.history-bars li')).toHaveCount(6);
  expect((await scan()).violations).toEqual([]);
});

test('a delayed obsolete history response cannot replace the active ownership scope', async ({ page }) => {
  await setup(page);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ownership/category-history?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    const old = !params.has('owner');
    if (old) await gate;
    await route.fulfill({ json: { bars: historyRanges(params.get('month')!).map(range => ({ ...range, amount: old ? 999999 : 123 })) } }).catch(() => {});
  });
  const firstRequest = page.waitForRequest(req => req.url().includes('/category-history?'));
  await page.locator('.donut-center').click();
  await firstRequest;
  await scope(page).getByRole('button', { name: 'MICHAEL', exact: true }).click();
  await expect(page.locator('.history-bars li').first()).toContainText('$1.23');
  release();
  await expect(page.locator('.history-bars li').first()).toContainText('$1.23');
  await expect(page.locator('.scope-total')).toContainText('$100.00');
});
