// Triggers the same SimpleFIN batch bank sync as Actual's UI "sync all now"
// button, then uploads the resulting budget changes. Run inside the
// nest-ledger-web container: node app/scripts/bank-sync.mjs. Compose injects
// ACTUAL_SERVER_URL, ACTUAL_SERVER_PASSWORD, ACTUAL_SYNC_ID and optionally
// ACTUAL_BUDGET_PASSWORD. Prints per-account counts and latest dates, plus any
// sync error; never prints credentials, payees or amounts. A partial failure
// (for example a SimpleFIN connection needing attention) still uploads the
// healthy accounts, prints the summary and exits 1 so the scheduler surfaces
// it. Exit codes: 1 sync or upload failed, 2 environment not configured.
import * as api from '@actual-app/api';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const required = ['ACTUAL_SERVER_URL', 'ACTUAL_SERVER_PASSWORD', 'ACTUAL_SYNC_ID'];
const missing = required.filter(name => !process.env[name]);
if (missing.length > 0) {
  console.error(`bank-sync: missing environment: ${missing.join(', ')}`);
  process.exit(2);
}
const url = new URL(process.env.ACTUAL_SERVER_URL);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
  console.error('bank-sync: ACTUAL_SERVER_URL must be an HTTP(S) base URL without credentials');
  process.exit(2);
}
const message = err => (err && err.message ? err.message : String(err));

const dataDir = await mkdtemp(join(tmpdir(), 'nest-ledger-bank-sync-'));
let loaded = false;
let syncError = null;
try {
  await api.init({
    dataDir,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_SERVER_PASSWORD,
    verbose: false,
  });
  await api.downloadBudget(process.env.ACTUAL_SYNC_ID, {
    password: process.env.ACTUAL_BUDGET_PASSWORD || undefined,
  });
  loaded = true;

  try {
    await api.runBankSync();
  } catch (err) {
    // At least one account failed; healthy accounts' imports are still buffered.
    syncError = err;
  }
  try {
    await api.sync();
  } catch (err) {
    if (syncError) console.error(`bank-sync: upload also failed: ${message(err)}`);
    syncError = syncError ?? err;
  }

  const through = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  for (const account of await api.getAccounts()) {
    const transactions = await api.getTransactions(account.id, from, through);
    const latest = transactions.reduce((max, t) => (t.date > max ? t.date : max), '') || 'none';
    console.log(`bank-sync: ${account.name}: ${transactions.length} rows ${from}..${through}, latest ${latest}`);
  }
} catch (err) {
  console.error(`bank-sync: ${message(err)}`);
  process.exitCode = 1;
} finally {
  if (syncError) {
    console.error(`bank-sync: ${message(syncError)}`);
    process.exitCode = 1;
  } else if (loaded && !process.exitCode) {
    console.log('SYNC-DONE');
  }
  try {
    await api.shutdown();
  } catch {
    // Shutdown is best-effort; the failure was already reported.
  }
  await rm(dataDir, { recursive: true, force: true });
}
