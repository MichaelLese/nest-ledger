import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scryptSync, createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { categoryName, allocate, leaves, payerHint, parseMetadata, type Metadata } from '../src/server/ownership';
import { checkPassword, sameOrigin, signSession, verifySession } from '../src/server/session';
import { db, householdConfig, readMetadata, saveMetadata } from '../src/server/db';
const rule = { id: 'test-rule', name: '50/50', me_percentage: '50.00', wife_percentage: '50.00' };
const valid: Metadata = { actual_transaction_id: 'actual-id', expense_owner: 'JOINT', payer: 'LIZ', split_rule: rule.id, notes: null, review_status: 'REVIEWED' };
test('account hints recognize prefixes without inferring expense ownership', () => {
  for (const name of ['Michael Checking', 'michael-card', ' Michael: Savings']) assert.equal(payerHint(name), 'MICHAEL');
  assert.equal(payerHint('Liz'), 'LIZ'); assert.equal(payerHint('Joint Savings'), 'JOINT');
  assert.equal(payerHint('Elizabeth'), null); assert.equal(payerHint('Michaelson'), null); assert.equal(payerHint('Savings Liz'), null);
});
test('review requires owner and payer; joint rule must exist; personal rule is rejected', () => {
  assert.deepEqual(parseMetadata(valid, [rule]), valid);
  for (const patch of [{ expense_owner: null }, { payer: null }, { expense_owner: 'ME' }, { payer: 'WIFE' }, { split_rule: 'missing' }, { expense_owner: 'MICHAEL' }, { review_status: 'yes' }, { notes: 'x'.repeat(2001) }, { actual_transaction_id: '' }]) assert.throws(() => parseMetadata({ ...valid, ...patch }, [rule]));
  assert.equal(parseMetadata({ ...valid, expense_owner: null, payer: null, split_rule: null, review_status: 'NEEDS_REVIEW' }, [rule]).review_status, 'NEEDS_REVIEW');
});
test('joint split preserves signed integer total, rounding half minor units to Michael', () => {
  assert.deepEqual(allocate(-101, rule), { MICHAEL: -51, LIZ: -50 });
  assert.deepEqual(allocate(101, rule), { MICHAEL: 51, LIZ: 50 });
  assert.deepEqual(allocate(10000, { ...rule, me_percentage: '33.33', wife_percentage: '66.67' }), { MICHAEL: 3333, LIZ: 6667 });
  for (const amount of [-10003, -1, 0, 1, 10003, Number.MAX_SAFE_INTEGER]) { const split = allocate(amount, rule); assert.equal(split.MICHAEL + split.LIZ, amount); }
  assert.throws(() => allocate(1.1, rule));
});
test('Actual split children are individually tagged with no parent double count', () => {
  const child = { id: 'child', account: 'a', date: '2026-09-01', amount: -100, parent_id: 'parent' };
  const parent = { ...child, id: 'parent', is_parent: true, subtransactions: [child] };
  assert.deepEqual(leaves([parent, child]).map(t => t.id), ['child']);
  assert.equal(leaves([parent])[0].amount, -100);
});
test('category names resolve by Actual category ID, including hidden categories', () => {
  const transaction = { id: 't', account: 'a', date: '2026-09-01', amount: -100 };
  const categories = [{ id: 'food', name: 'Groceries' }, { id: 'old', name: 'Archived expense', hidden: true }];
  assert.equal(categoryName({ ...transaction, category: 'food' }, categories), 'Groceries');
  assert.equal(categoryName({ ...transaction, category: 'old' }, categories), 'Archived expense');
  for (const category of [undefined, null, '', 'unknown']) {
    assert.equal(categoryName({ ...transaction, category }, categories), null);
  }
  assert.equal(categoryName({ ...transaction, category: 'food' }, []), null);
});
test('split children display their own categories with no parent duplication', () => {
  const transaction = { account: 'a', date: '2026-09-01', amount: -100 };
  const children = [
    { ...transaction, id: 'food-child', parent_id: 'parent', category: 'food' },
    { ...transaction, id: 'home-child', parent_id: 'parent', category: 'home' },
    { ...transaction, id: 'uncategorized-child', parent_id: 'parent', category: null },
  ];
  const parent = { ...transaction, id: 'parent', is_parent: true, category: null, subtransactions: children };
  const categories = [{ id: 'food', name: 'Groceries' }, { id: 'home', name: 'Household', hidden: true }];
  for (const transactions of [[parent], [parent, ...children], children]) {
    assert.deepEqual(leaves(transactions).map(t => [t.id, categoryName(t, categories)]), [
      ['food-child', 'Groceries'], ['home-child', 'Household'], ['uncategorized-child', null],
    ]);
  }
});
test('sessions reject tampering, expiration, wrong secrets and JOINT identity', () => {
  process.env.AUTH_SESSION_SECRET = 'a'.repeat(32);
  const token = signSession('MICHAEL', 1000);
  assert.equal(verifySession(token, 2000), 'MICHAEL');
  assert.equal(verifySession(token, 13 * 3600_000), null);
  assert.equal(verifySession(token + 'x', 2000), null);
  const body = Buffer.from(JSON.stringify({ member: 'JOINT', expires: 9999999999 })).toString('base64url');
  assert.equal(verifySession(body + '.' + createHmac('sha256', process.env.AUTH_SESSION_SECRET).update(body).digest('base64url')), null);
  process.env.AUTH_SESSION_SECRET = 'b'.repeat(32); assert.equal(verifySession(token, 2000), null);
  delete process.env.AUTH_SESSION_SECRET; assert.equal(verifySession(token), null);
});
test('password hashes and explicit origin are required', async () => {
  process.env.AUTH_SESSION_SECRET = 'a'.repeat(32);
  const salt = 'b'.repeat(32);
  process.env.AUTH_LIZ_PASSWORD_HASH = salt + ':' + scryptSync('fixture-password', salt, 64).toString('hex');
  assert.equal(await checkPassword('LIZ', 'fixture-password'), true);
  assert.equal(await checkPassword('LIZ', 'wrong'), false);
  delete process.env.AUTH_MICHAEL_PASSWORD_HASH; await assert.rejects(checkPassword('MICHAEL', 'anything'));
  process.env.AUTH_ORIGIN = 'https://household.example';
  assert.equal(sameOrigin(new Request('http://localhost', { headers: { origin: 'https://household.example' } })), true);
  assert.equal(sameOrigin(new Request('http://localhost', { headers: { origin: 'https://evil.example' } })), false);
  assert.equal(sameOrigin(new Request('http://localhost')), false);
});
test('repository persists metadata against actual migrations, preserves independent payer and resets review', async () => {
  const pg = new PGlite();
  const originalQuery = db.query;
  // Run repository SQL on embedded PostgreSQL using the unchanged project migrations.
  db.query = ((sql: string, params?: unknown[]) => pg.query(sql, params)) as typeof db.query;
  try {
    for (const name of ['001_household_metadata.sql', '002_household_member_names.sql']) await pg.exec(await readFile(new URL('../../infrastructure/migrations/' + name, import.meta.url), 'utf8'));
    const config = await householdConfig();
    assert.equal(config.rules.length, 1);
    assert.deepEqual(await readMetadata(['actual-id']), []);
    const metadata = parseMetadata({ ...valid, split_rule: config.defaultSplit, notes: "Private ' note" }, config.rules);
    await saveMetadata(metadata);
    assert.deepEqual(await readMetadata(['actual-id']), [metadata]);
    const changed = { ...metadata, expense_owner: 'MICHAEL' as const, split_rule: null, review_status: 'NEEDS_REVIEW' as const };
    await saveMetadata(changed);
    assert.deepEqual(await readMetadata(['actual-id']), [changed]);
    assert.equal((await pg.query('SELECT * FROM transaction_metadata')).rows.length, 1);
    assert.equal((await pg.query('SELECT * FROM bills')).rows.length, 0);
  } finally { db.query = originalQuery; await pg.close(); await db.end(); }
});
