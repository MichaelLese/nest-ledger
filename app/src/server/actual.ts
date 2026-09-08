import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function readActualSummary(start: string, end: string): Promise<unknown> {
  const modulePath = pathToFileURL(join(process.cwd(), 'scripts/actual-summary.mjs')).href;
  const client = await import(/* webpackIgnore: true */ modulePath);
  return client.readActualSummary(start, end);
}

// Coalesce simultaneous reads: the SDK loads one budget per isolated child.
let pending: Promise<unknown> | undefined;
export function getActualSummary(): Promise<unknown> {
  if (!pending) {
    const today = new Date().toISOString().slice(0, 10);
    pending = readActualSummary(today.slice(0, 8) + '01', today)
      .finally(() => { pending = undefined; });
  }
  return pending;
}
