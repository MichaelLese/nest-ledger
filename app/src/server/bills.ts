import { members, type Member } from './ownership';

// Fields exposed by the pinned SDK's scheduleModel.toExternal. Amount may be a range.
export type Schedule = { id: string; name?: string | null; next_date?: string | null; amount?: unknown };
export type BillMetadata = { actual_schedule_id: string; responsible_person: Member | null; autopay: boolean };
export type BillCard = BillMetadata & { name: string; next_date: string | null; amount: number | null };
export function billCards(schedules: Schedule[] = [], metadata: BillMetadata[] = []): BillCard[] {
  const saved = new Map(metadata.map(row => [row.actual_schedule_id, row]));
  return schedules.map(schedule => ({
    actual_schedule_id: schedule.id,
    name: schedule.name?.trim() || 'Unnamed schedule',
    next_date: schedule.next_date || null,
    amount: typeof schedule.amount === 'number' && Number.isSafeInteger(schedule.amount) ? schedule.amount : null,
    responsible_person: saved.get(schedule.id)?.responsible_person ?? null,
    autopay: saved.get(schedule.id)?.autopay ?? false,
  }));
}
export function parseBillMetadata(value: unknown): BillMetadata {
  if (!value || typeof value !== 'object') throw new Error('Invalid bill metadata.');
  const v = value as Record<string, unknown>;
  if (typeof v.actual_schedule_id !== 'string' || !v.actual_schedule_id.trim() || v.actual_schedule_id.length > 200
    || !(v.responsible_person === null || members.includes(v.responsible_person as Member))
    || typeof v.autopay !== 'boolean') throw new Error('Invalid bill metadata.');
  return { actual_schedule_id: v.actual_schedule_id, responsible_person: v.responsible_person as Member | null, autopay: v.autopay };
}
