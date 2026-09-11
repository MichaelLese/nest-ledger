import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function readActualSummary(start: string, end: string): Promise<unknown> {
  const modulePath = pathToFileURL(join(process.cwd(), 'scripts/actual-summary.mjs')).href;
  const client = await import(/* webpackIgnore: true */ modulePath);
  return client.readActualSummary(start, end);
}

export type ActualDateRange = { from: string; through: string };

// Coalesce only matching ranges: each isolated child loads one budget.
const pending = new Map<string, Promise<unknown>>();
export function getActualSummary(range?: ActualDateRange): Promise<unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const { from, through } = range ?? { from: today.slice(0, 8) + '01', through: today };
  const key = JSON.stringify([from, through]);
  let result = pending.get(key);
  if (!result) {
    result = readActualSummary(from, through)
      .finally(() => { pending.delete(key); });
    pending.set(key, result);
  }
  return result;
}
