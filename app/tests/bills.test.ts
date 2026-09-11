import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { billCards, billDueStatus, parseBillMetadata } from '../src/server/bills';
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
  assert.deepEqual(cards[0], { actual_schedule_id: 'rent', payingAccount: null, name: 'Rent', next_date: '2026-10-01', amount: -125000, responsible_person: 'JOINT', autopay: true });
  assert.deepEqual(cards[1], { actual_schedule_id: 'zero', payingAccount: null, name: 'Unnamed schedule', next_date: null, amount: 0, responsible_person: null, autopay: false });
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

test('bills sort by next date ascending with stable ties and missing dates last', () => {
  const schedules = [
    { id: 'missing' }, { id: 'later', next_date: '2027-01-01' },
    { id: 'soon', next_date: '2026-09-12' }, { id: 'overdue', next_date: '2026-08-31' },
    { id: 'same-day', next_date: '2026-09-12' }, { id: 'null', next_date: null },
  ];
  assert.deepEqual(billCards(schedules).map(row => row.actual_schedule_id), ['overdue', 'soon', 'same-day', 'later', 'missing', 'null']);
  assert.equal(schedules[0].id, 'missing');
});
test('due badges use UTC calendar days, include today and day seven, and omit distant or missing dates', () => {
  const today = '2026-12-28';
  assert.deepEqual(billDueStatus('2026-12-27', today), { kind: 'overdue', label: 'overdue' });
  for (const [date, days] of [['2026-12-28', 0], ['2026-12-29', 1], ['2027-01-04', 7]] as const) {
    assert.deepEqual(billDueStatus(date, today), { kind: 'due-soon', label: `due in ${days} d` });
  }
  for (const date of [null, '2027-01-05', 'invalid']) assert.equal(billDueStatus(date, today), null);
  assert.deepEqual(billDueStatus('2028-03-01', '2028-02-29'), { kind: 'due-soon', label: 'due in 1 d' });
});

test('paying accounts resolve only from schedule account IDs and never assign responsibility', () => {
  const cards = billCards([
    { id: 'known', account: 'bank' }, { id: 'unknown', account: 'missing' },
    { id: 'unset', account: null }, { id: 'absent' },
  ], [], [{ id: 'bank', name: 'Liz Checking' }]);
  assert.deepEqual(cards.map(row => row.payingAccount), ['Liz Checking', null, null, null]);
  assert.ok(cards.every(row => row.responsible_person === null));
});
