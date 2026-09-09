import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readActualSummary } from '../scripts/actual-summary.mjs';

test('missing configuration is actionable', async () => {
  delete process.env.ACTUAL_SERVER_URL;
  await assert.rejects(readActualSummary('2026-09-01', '2026-09-08'), /set ACTUAL_SERVER_URL/);
});

test('SDK reaches server, sanitizes failures, and allows subsequent attempts', async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'private-server-diagnostic' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.ACTUAL_SERVER_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ACTUAL_SERVER_PASSWORD = 'test-only-placeholder';
  process.env.ACTUAL_SYNC_ID = 'test-only-placeholder';
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(readActualSummary('2026-09-01', '2026-09-08'), error => {
        assert.match(error.message, /Actual could not be loaded/);
        assert.doesNotMatch(error.message, /private-server-diagnostic|test-only-placeholder/);
        return true;
      });
    }
    assert.ok(requests >= 2, 'both attempts must actually reach the fake server');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('hung SDK connection is terminated at the deadline', async () => {
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.ACTUAL_SERVER_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(readActualSummary('2026-09-01', '2026-09-08'), /timed out/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
