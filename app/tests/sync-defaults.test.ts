import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { accountMember, defaultMetadataRows, isLeafTransaction, readDefaultSplit, saveDefaultMetadata } from '../scripts/bank-sync.mjs';
import { payerHint } from '../src/server/ownership';

const accounts = [
  { id: 'm', name: 'Michael Checking' },
  { id: 'l', name: 'Liz Card' },
  { id: 'j', name: 'Joint Savings' },
  { id: 'u', name: 'Chase United' },
];
const transaction = (id: string, account: string) => ({ id, account, date: '2026-09-01', amount: -100 });

test('bank-sync account member mirrors the app payer hint', () => {
  for (const name of ['Michael Checking', 'michael-card', ' Michael: Savings', 'Liz', 'Joint Savings', 'Elizabeth', 'Michaelson', 'Savings Liz', 'Chase United', 'Citi Strata', 'CitiBank Checkings']) {
    assert.equal(accountMember(name), payerHint(name), name);
  }
});

test('only leaf transactions are defaulted; Actual split parents are skipped', () => {
  assert.equal(isLeafTransaction(transaction('a', 'm')), true);
  const child = { ...transaction('child', 'm'), parent_id: 'parent' };
  const parent = { ...transaction('parent', 'm'), is_parent: true, subtransactions: [child] };
  assert.equal(isLeafTransaction(parent), false);
  assert.equal(isLeafTransaction(child), true);
});

test('default rows save owner and payer from the account member; unmapped accounts stay unclassified', () => {
  const child = { ...transaction('child', 'j'), parent_id: 'parent' };
  const result = defaultMetadataRows([
    transaction('m1', 'm'), transaction('l1', 'l'), child,
    { ...transaction('parent', 'j'), is_parent: true, subtransactions: [child] },
    transaction('u1', 'u'), transaction('m1', 'm'),
  ], accounts, 'rule-5050');
  assert.deepEqual(result, {
    rows: [
      { actual_transaction_id: 'm1', expense_owner: 'MICHAEL', payer: 'MICHAEL', split_rule: null, notes: null, review_status: 'REVIEWED' },
      { actual_transaction_id: 'l1', expense_owner: 'LIZ', payer: 'LIZ', split_rule: null, notes: null, review_status: 'REVIEWED' },
      { actual_transaction_id: 'child', expense_owner: 'JOINT', payer: 'JOINT', split_rule: 'rule-5050', notes: null, review_status: 'REVIEWED' },
    ],
    unmapped: 1,
  });
});

test('owner defaults insert against real migrations and never overwrite saved rows', async () => {
  const pg = new PGlite();
  const query = (sql: string, params?: unknown[]) => (params === undefined ? pg.query(sql) : pg.query(sql, params));
  try {
    for (const name of ['001_household_metadata.sql', '002_household_member_names.sql']) await pg.exec(await readFile(new URL('../../infrastructure/migrations/' + name, import.meta.url), 'utf8'));
    const split = await readDefaultSplit(query);
    assert.equal(split, ((await pg.query("SELECT id FROM split_rules WHERE name = '50/50'")).rows[0] as { id: string }).id);
    // A prior manual edit must survive bank-sync defaulting.
    await pg.query(`INSERT INTO transaction_metadata (actual_transaction_id, expense_owner, payer, split_rule, notes, review_status)
      VALUES ('m1','LIZ','MICHAEL',NULL,'edited','REVIEWED')`);
    const { rows } = defaultMetadataRows([transaction('m1', 'm'), transaction('j1', 'j'), transaction('l1', 'l'), transaction('u1', 'u')], accounts, split);
    assert.equal(await saveDefaultMetadata(query, rows), 2);
    assert.deepEqual((await pg.query('SELECT actual_transaction_id, expense_owner, payer, split_rule, notes, review_status FROM transaction_metadata ORDER BY actual_transaction_id')).rows, [
      { actual_transaction_id: 'j1', expense_owner: 'JOINT', payer: 'JOINT', split_rule: split, notes: null, review_status: 'REVIEWED' },
      { actual_transaction_id: 'l1', expense_owner: 'LIZ', payer: 'LIZ', split_rule: null, notes: null, review_status: 'REVIEWED' },
      { actual_transaction_id: 'm1', expense_owner: 'LIZ', payer: 'MICHAEL', split_rule: null, notes: 'edited', review_status: 'REVIEWED' },
    ]);
    assert.equal(await saveDefaultMetadata(query, rows), 0);
  } finally { await pg.close(); }
});

test('defaulting chunks large histories and counts only new rows', async () => {
  const pg = new PGlite();
  const query = (sql: string, params?: unknown[]) => (params === undefined ? pg.query(sql) : pg.query(sql, params));
  try {
    for (const name of ['001_household_metadata.sql', '002_household_member_names.sql']) await pg.exec(await readFile(new URL('../../infrastructure/migrations/' + name, import.meta.url), 'utf8'));
    const split = await readDefaultSplit(query);
    const many = Array.from({ length: 501 }, (_, index) => transaction('t' + index, 'm'));
    const { rows } = defaultMetadataRows(many, accounts, split);
    assert.equal(rows.length, 501);
    assert.equal(await saveDefaultMetadata(query, rows), 501);
    assert.equal(await saveDefaultMetadata(query, rows), 0);
  } finally { await pg.close(); }
});
