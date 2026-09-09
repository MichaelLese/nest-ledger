import { Pool } from 'pg';
import type { Metadata, SplitRule } from './ownership';
const globalDb = globalThis as unknown as { householdPool?: Pool };
export const db = globalDb.householdPool ??= new Pool({ max: 4, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
export async function householdConfig() {
  const rules = await db.query<SplitRule>('SELECT id, name, me_percentage, wife_percentage FROM split_rules ORDER BY name');
  const settings = await db.query('SELECT default_joint_split, currency FROM household_settings WHERE id = true');
  if (!settings.rows[0]) throw new Error('Household settings missing');
  return { rules: rules.rows, defaultSplit: settings.rows[0].default_joint_split as string | null, currency: settings.rows[0].currency as string };
}
export async function readMetadata(ids: string[]) {
  return (await db.query<Metadata>('SELECT actual_transaction_id, expense_owner, payer, split_rule, notes, review_status FROM transaction_metadata WHERE actual_transaction_id = ANY($1::text[])', [ids])).rows;
}
export async function saveMetadata(m: Metadata) {
  await db.query(`INSERT INTO transaction_metadata (actual_transaction_id, expense_owner, payer, split_rule, notes, review_status)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (actual_transaction_id) DO UPDATE SET
    expense_owner=EXCLUDED.expense_owner, payer=EXCLUDED.payer, split_rule=EXCLUDED.split_rule,
    notes=EXCLUDED.notes, review_status=EXCLUDED.review_status`,
  [m.actual_transaction_id, m.expense_owner, m.payer, m.split_rule, m.notes, m.review_status]);
}
