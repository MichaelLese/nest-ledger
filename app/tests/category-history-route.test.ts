import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActualDateRange } from '../src/server/actual';

test('history route authenticates, validates and reads one bounded range without writes', async () => {
  let authenticated = true, fail = false;
  const calls: ActualDateRange[] = [];
  const metadataReads: string[][] = [];
  const stubs = {
    '../src/server/auth': {
      currentMember: async () => authenticated ? 'LIZ' : null,
      privateHeaders: { 'Cache-Control': 'no-store' },
      jsonError: (error: string, status: number) => Response.json({ error }, { status }),
    },
    '../src/server/db': {
      readMetadata: async (ids: string[]) => { metadataReads.push(ids); return [{ actual_transaction_id: 'leaf', expense_owner: 'JOINT' }]; },
      saveMetadata: () => { throw new Error('Unexpected write'); },
    },
    '../src/server/actual': {
      getActualSummary: async (range: ActualDateRange) => {
        calls.push(range);
        if (fail) throw new Error('Sensitive SDK diagnostics');
        const leaf = { id: 'leaf', date: '2024-02-29', amount: -123, category: 'a', account: 'Michael checking' };
        return { accounts: [], categories: [], transactions: [
          { ...leaf, id: 'parent', is_parent: true, subtransactions: [leaf] }, leaf,
          { ...leaf, id: 'other', category: 'b' },
          { ...leaf, id: 'before', date: '2023-08-31' },
          { ...leaf, id: 'after', date: '2024-03-01' },
        ] };
      },
    },
  };
  const originals = new Map<string, NodeModule | undefined>();
  const routeId = require.resolve('../src/app/api/ownership/category-history/route');
  try {
    for (const [name, exports] of Object.entries(stubs)) {
      const id = require.resolve(name); originals.set(id, require.cache[id]);
      require.cache[id] = { id, filename: id, loaded: true, exports } as NodeModule;
    }
    const route = require(routeId) as typeof import('../src/app/api/ownership/category-history/route');
    assert.equal('PUT' in route, false);
    assert.equal('POST' in route, false);
    const get = (query: string) => route.GET(new Request('https://household.example/api/ownership/category-history' + query));
    authenticated = false;
    assert.equal((await get('?month=2024-02&category=a')).status, 401);
    assert.equal(calls.length, 0);
    authenticated = true;
    for (const query of ['', '?month=2024-02', '?month=2024-2&category=a', '?month=2024-02&month=2024-03&category=a', '?month=2024-02&category=a&category=b', '?month=2024-02&category=a&owner=ALL', '?month=2024-02&category=a&owner=LIZ&owner=LIZ', '?month=9999-12&category=a']) {
      assert.equal((await get(query)).status, 400, query);
    }
    assert.equal(calls.length, 0);
    const response = await get('?month=2024-02&category=a&owner=LIZ&owner=JOINT');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(calls, [{ from: '2023-09-01', through: '2024-02-29' }]);
    assert.deepEqual(metadataReads, [['leaf', 'other']]);
    assert.deepEqual((await response.json()).bars.map((row: { amount: number }) => row.amount), [0, 0, 0, 0, 0, 123]);
    const empty = await get('?month=2024-02&category=&owner=MICHAEL');
    assert.deepEqual((await empty.json()).bars.map((row: { amount: number }) => row.amount), [0, 0, 0, 0, 0, 0]);
    fail = true;
    const failed = await get('?month=2024-02&category=a');
    assert.equal(failed.status, 503);
    assert.equal((await failed.text()).includes('Sensitive'), false);
  } finally {
    delete require.cache[routeId];
    for (const [id, original] of originals) {
      if (original) require.cache[id] = original; else delete require.cache[id];
    }
  }
});
