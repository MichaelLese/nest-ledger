import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { billCards, parseBillMetadata } from '../src/server/bills';
import { db, readBills, saveBills } from '../src/server/db';

test('cards match schedule IDs, preserve exposed dates and zero amounts, and omit missing or range amounts', () => {
  assert.deepEqual(billCards(), []);
  assert.deepEqual(billCards([], [{ actual_schedule_id: 'orphan', responsible_person: 'LIZ', autopay: true }]), []);
  const cards = billCards([
    { id: 'rent', name: 'Rent', next_date: '2026-10-01', amount: -125000 },
    { id: 'zero', name: '', amount: 0 },
    { id: 'missing' },
    { id: 'range', amount: { num1: -100, num2: -200 } },
  ], [{ actual_schedule_id: 'rent', responsible_person: 'JOINT', autopay: true }]);
  assert.deepEqual(cards[0], { actual_schedule_id: 'rent', name: 'Rent', next_date: '2026-10-01', amount: -125000, responsible_person: 'JOINT', autopay: true });
  assert.deepEqual(cards[1], { actual_schedule_id: 'zero', name: 'Unnamed schedule', next_date: null, amount: 0, responsible_person: null, autopay: false });
  assert.equal(cards[2].amount, null);
  assert.equal(cards[3].amount, null);
});
test('bill payload validates member, schedule ID and boolean without accepting unrelated writes', () => {
  const valid = { actual_schedule_id: 'a', responsible_person: null, autopay: false };
  assert.deepEqual(parseBillMetadata({ ...valid, name: 'untrusted', expense_owner: 'LIZ' }), valid);
  for (const value of [null, {}, { ...valid, actual_schedule_id: ' ' }, { ...valid, actual_schedule_id: 'x'.repeat(201) }, { ...valid, responsible_person: 'ME' }, { ...valid, responsible_person: undefined }, { ...valid, autopay: 'false' }]) assert.throws(() => parseBillMetadata(value));
});
test('bills upsert uses real migrations, resolves member UUID, and preserves other household metadata', async () => {
  const pg = new PGlite();
  const originalQuery = db.query;
  db.query = ((sql: string, params?: unknown[]) => pg.query(sql, params)) as typeof db.query;
  try {
    for (const name of ['001_household_metadata.sql', '002_household_member_names.sql']) await pg.exec(await readFile(new URL('../../infrastructure/migrations/' + name, import.meta.url), 'utf8'));
    assert.deepEqual(await readBills([]), []);
    const initial = { actual_schedule_id: "schedule'1", responsible_person: 'MICHAEL' as const, autopay: false };
    await saveBills(initial, "House's bill");
    assert.deepEqual(await readBills([initial.actual_schedule_id]), [initial]);
    await pg.exec("UPDATE bills SET notes = 'retain', expected_amount = 123, expense_owner = 'LIZ'");
    for (const responsible_person of ['LIZ', 'JOINT', null] as const) {
      const changed = { ...initial, responsible_person, autopay: true };
      await saveBills(changed, 'Renamed in Actual');
      assert.deepEqual(await readBills([initial.actual_schedule_id]), [changed]);
    }
    assert.deepEqual((await pg.query('SELECT name, notes, expected_amount::integer, expense_owner FROM bills')).rows, [{ name: 'Renamed in Actual', notes: 'retain', expected_amount: 123, expense_owner: 'LIZ' }]);
    assert.deepEqual(await readBills(['missing']), []);
    assert.equal((await pg.query('SELECT * FROM transaction_metadata')).rows.length, 0);
  } finally { db.query = originalQuery; await pg.close(); await db.end(); }
});
