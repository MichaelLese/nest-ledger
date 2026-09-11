import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getActualSummary } from '../src/server/actual';

test('Actual summary preserves UTC defaults, forwards ranges, isolates reads and retries failures', async () => {
  const original = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), 'actual-range-test-'));
  await mkdir(join(dir, 'scripts'));
  // Exercise the real wrapper through its existing dynamically loaded reader boundary.
  await writeFile(join(dir, 'scripts/actual-summary.mjs'), `
    let calls = 0;
    export async function readActualSummary(start, end) {
      const call = ++calls;
      await new Promise(resolve => setTimeout(resolve, 10));
      if (start === 'fail') throw new Error('reader failed');
      return { start, end, call };
    }
  `);
  process.chdir(dir);
  try {
    const today = new Date().toISOString().slice(0, 10);
    const current = getActualSummary();
    assert.equal(getActualSummary(), current);
    assert.equal(getActualSummary({ from: today.slice(0, 8) + '01', through: today }), current);
    const range = { from: '2024-02-01', through: '2024-02-29' };
    const historical = getActualSummary(range);
    assert.equal(getActualSummary(range), historical);
    assert.notEqual(current, historical);
    assert.deepEqual(await current, { start: today.slice(0, 8) + '01', end: today, call: 1 });
    assert.deepEqual(await historical, { start: range.from, end: range.through, call: 2 });
    assert.deepEqual(await getActualSummary(range), { start: range.from, end: range.through, call: 3 });
    for (let i = 0; i < 2; i++) {
      await assert.rejects(getActualSummary({ from: 'fail', through: '2024-02-29' }), /reader failed/);
    }
    assert.deepEqual(await getActualSummary(range), { start: range.from, end: range.through, call: 6 });
  } finally {
    process.chdir(original);
    await rm(dir, { recursive: true, force: true });
  }
});
