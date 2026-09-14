import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = (name: string) => readFile(new URL(`../../infrastructure/migrations/${name}`, import.meta.url), 'utf8');
const backfill = () => migration('003_backfill_metadata_reviewed.sql');
async function setup() {
  const pg = new PGlite();
  for (const name of ['001_household_metadata.sql', '002_household_member_names.sql']) await pg.exec(await migration(name));
  return pg;
}

test('backfill preserves metadata, fills only missing defaults, and is idempotent', async () => {
  const pg = await setup();
  try {
    await pg.exec(`
      INSERT INTO split_rules (name, me_percentage, wife_percentage) VALUES ('custom', 60, 40);
      INSERT INTO transaction_metadata (actual_transaction_id, expense_owner, payer, split_rule, notes, review_status) VALUES
      ('m', 'MICHAEL', NULL, NULL, 'keep note', 'NEEDS_REVIEW'),
      ('l', 'LIZ', 'MICHAEL', NULL, NULL, 'NEEDS_REVIEW'),
      ('j', 'JOINT', NULL, NULL, NULL, 'NEEDS_REVIEW'),
      ('custom', 'JOINT', 'LIZ', (SELECT id FROM split_rules WHERE name = 'custom'), 'edited', 'NEEDS_REVIEW'),
      ('reviewed', 'JOINT', NULL, NULL, 'untouched', 'REVIEWED'),
      ('unknown', NULL, NULL, NULL, NULL, 'NEEDS_REVIEW');
    `);
    const before = (await pg.query<any>('SELECT * FROM transaction_metadata ORDER BY actual_transaction_id')).rows;
    const defaultSplit = (await pg.query<any>('SELECT default_joint_split FROM household_settings')).rows[0].default_joint_split;
    await pg.exec(await backfill());
    const after = (await pg.query('SELECT * FROM transaction_metadata ORDER BY actual_transaction_id')).rows;
    assert.deepEqual(after, before.map(row => row.review_status === 'REVIEWED' ? row : {
      ...row, review_status: 'REVIEWED', payer: row.payer ?? row.expense_owner,
      split_rule: row.expense_owner === 'JOINT' ? row.split_rule ?? defaultSplit : row.split_rule,
    }));
    await pg.exec(await backfill());
    assert.deepEqual((await pg.query('SELECT * FROM transaction_metadata ORDER BY actual_transaction_id')).rows, after);
  } finally { await pg.close(); }
});

for (const missing of ['null default', 'missing settings']) {
  test(`backfill rolls back when JOINT needs a split with ${missing}`, async () => {
    const pg = await setup();
    try {
      await pg.exec(missing === 'null default' ? 'UPDATE household_settings SET default_joint_split = NULL' : 'DELETE FROM household_settings');
      await pg.exec(`INSERT INTO transaction_metadata (actual_transaction_id, expense_owner) VALUES ('m', 'MICHAEL'), ('j', 'JOINT')`);
      const before = (await pg.query('SELECT * FROM transaction_metadata ORDER BY actual_transaction_id')).rows;
      await assert.rejects(pg.exec(await backfill()), /requires a household default joint split/);
      await pg.exec('ROLLBACK');
      assert.deepEqual((await pg.query('SELECT * FROM transaction_metadata ORDER BY actual_transaction_id')).rows, before);
    } finally { await pg.close(); }
  });
}
