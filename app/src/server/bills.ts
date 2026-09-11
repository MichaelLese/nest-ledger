import { members, type Member } from './ownership';

// Fields exposed by the pinned SDK's scheduleModel.toExternal. Amount may be a range.
export type Schedule = { id: string; name?: string | null; next_date?: string | null; amount?: unknown; account?: string | null };
export type BillMetadata = { actual_schedule_id: string; responsible_person: Member | null; autopay: boolean };
export type BillCard = BillMetadata & { name: string; next_date: string | null; amount: number | null; payingAccount: string | null };
export function billCards(schedules: Schedule[] = [], metadata: BillMetadata[] = [], accounts: { id: string; name: string }[] = []): BillCard[] {
  const accountNames = new Map(accounts.map(account => [account.id, account.name]));
  const saved = new Map(metadata.map(row => [row.actual_schedule_id, row]));
  return schedules.map(schedule => ({
    actual_schedule_id: schedule.id,
    payingAccount: schedule.account ? accountNames.get(schedule.account) || null : null,
    name: schedule.name?.trim() || 'Unnamed schedule',
    next_date: schedule.next_date || null,
    amount: typeof schedule.amount === 'number' && Number.isSafeInteger(schedule.amount) ? schedule.amount : null,
    responsible_person: saved.get(schedule.id)?.responsible_person ?? null,
    autopay: saved.get(schedule.id)?.autopay ?? false,
  })).sort((a, b) => a.next_date === b.next_date ? 0 : a.next_date === null ? 1 : b.next_date === null ? -1 : a.next_date.localeCompare(b.next_date));
}
export function parseBillMetadata(value: unknown): BillMetadata {
  if (!value || typeof value !== 'object') throw new Error('Invalid bill metadata.');
  const v = value as Record<string, unknown>;
  if (typeof v.actual_schedule_id !== 'string' || !v.actual_schedule_id.trim() || v.actual_schedule_id.length > 200
    || !(v.responsible_person === null || members.includes(v.responsible_person as Member))
    || typeof v.autopay !== 'boolean') throw new Error('Invalid bill metadata.');
  return { actual_schedule_id: v.actual_schedule_id, responsible_person: v.responsible_person as Member | null, autopay: v.autopay };
}

// Compare calendar dates in UTC, matching the ownership view's reporting day.
export function billDueStatus(nextDate: string | null, today = new Date().toISOString().slice(0, 10)): { kind: 'overdue' | 'due-soon'; label: string } | null {
  if (!nextDate) return null;
  const days = (Date.parse(nextDate + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86_400_000;
  if (days < 0) return { kind: 'overdue', label: 'overdue' };
  if (days <= 7) return { kind: 'due-soon', label: `due in ${days} d` };
  return null;
}
