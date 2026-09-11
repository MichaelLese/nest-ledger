import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActualDateRange } from '../src/server/actual';
import type { Metadata } from '../src/server/ownership';

test('ownership PUT validates selected months and preserves default saves', async () => {
  const calls: (ActualDateRange | undefined)[] = [];
  const saved: Metadata[] = [];
  let authenticated = true;
  const today = new Date().toISOString().slice(0, 10);
  const valid: Metadata = { actual_transaction_id: 'past', expense_owner: 'MICHAEL', payer: 'LIZ', split_rule: null, notes: null, review_status: 'REVIEWED' };
  // Replace external boundaries before loading the real route; keep parsing and origin checks real.
  const stubs = {
    '../src/server/auth': {
      currentMember: async () => authenticated ? 'MICHAEL' : null,
      privateHeaders: { 'Cache-Control': 'no-store' },
      jsonError: (error: string, status: number) => Response.json({ error }, { status }),
    },
    '../src/server/db': {
      householdConfig: async () => ({ rules: [] }),
      saveMetadata: async (metadata: Metadata) => { saved.push(metadata); },
    },
    '../src/server/actual': {
      getActualSummary: async (range?: ActualDateRange) => {
        calls.push(range);
        const transactions = [
          { id: 'current', date: today, account: 'a', amount: -100 },
          { id: 'past', date: '2024-02-29', account: 'a', amount: -100 },
          { id: 'before', date: '2024-01-31', account: 'a', amount: -100 },
          { id: 'after', date: '2024-03-01', account: 'a', amount: -100 },
          { id: 'parent', date: '2024-02-10', account: 'a', amount: -100, is_parent: true },
        ];
        // Deliberately return out-of-range rows for explicit reads to verify route enforcement.
        return { transactions: range ? transactions : transactions.filter(t => t.date === today) };
      },
    },
  };
  const originals = new Map<string, NodeModule | undefined>();
  const origin = process.env.AUTH_ORIGIN;
  process.env.AUTH_ORIGIN = 'https://household.example';
  const routeId = require.resolve('../src/app/api/ownership/route');
  try {
    for (const [name, exports] of Object.entries(stubs)) {
      const id = require.resolve(name);
      originals.set(id, require.cache[id]);
      require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
    }
    const { PUT } = require(routeId) as typeof import('../src/app/api/ownership/route');
    const put = (query: string, id = 'past', review_status = valid.review_status, requestOrigin = process.env.AUTH_ORIGIN!) => PUT(new Request('https://household.example/api/ownership' + query, {
      method: 'PUT', headers: { origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...valid, actual_transaction_id: id, review_status }),
    }));
    for (const status of ['NEEDS_REVIEW', 'REVIEWED'] as const) {
      const response = await put('?month=2024-02', 'past', status);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).metadata, { ...valid, review_status: status });
      assert.deepEqual(calls.at(-1), { from: '2024-02-01', through: '2024-02-29' });
    }
    for (const id of ['before', 'after', 'current', 'missing', 'parent']) assert.equal((await put('?month=2024-02', id)).status, 409);
    assert.equal((await put('?month=2024-03')).status, 409);
    assert.equal(saved.length, 2);
    const reads = calls.length;
    for (const query of ['?month=', '?month=2024-2', '?month=2024-13', '?month=0000-01', '?month=2024-02-01', '?month=2024-02&month=2024-03', '?month=2024-02&month=2024-02']) {
      assert.equal((await put(query)).status, 400, query);
    }
    assert.equal(calls.length, reads);
    assert.equal(saved.length, 2);
    assert.equal((await put('', 'current')).status, 200);
    assert.equal(calls.at(-1), undefined);
    assert.equal((await put('')).status, 409);
    assert.equal((await put('?month=' + today.slice(0, 7), 'current')).status, 200);
    assert.deepEqual(calls.at(-1), { from: today.slice(0, 8) + '01', through: today });
    assert.equal(saved.length, 4);
    assert.equal((await put('?month=2024-02', 'past', 'REVIEWED', 'https://other.example')).status, 403);
    authenticated = false;
    assert.equal((await put('?month=2024-02')).status, 401);
    assert.equal(saved.length, 4);
  } finally {
    delete require.cache[routeId];
    for (const [id, original] of originals) {
      if (original) require.cache[id] = original;
      else delete require.cache[id];
    }
    if (origin === undefined) delete process.env.AUTH_ORIGIN;
    else process.env.AUTH_ORIGIN = origin;
  }
});
