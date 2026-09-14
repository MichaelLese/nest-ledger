// Triggers the same SimpleFIN batch bank sync as Actual's UI "sync all now"
// button, uploads the resulting budget changes, then saves the household
// default for synced transactions immediately: expense owner and payer are
// set to the paying account's household member. An account maps to a member
// through its Michael/Liz/Joint name prefix, mirroring the app's payer hint;
// accounts without a prefix stay unclassified until edited in the app. The
// scan covers the whole downloaded budget and never overwrites existing
// household metadata rows. Run inside the nest-ledger-web container:
// node app/scripts/bank-sync.mjs. Compose injects ACTUAL_SERVER_URL,
// ACTUAL_SERVER_PASSWORD, ACTUAL_SYNC_ID, optionally ACTUAL_BUDGET_PASSWORD,
// and the PostgreSQL environment. Prints per-account row counts, latest
// transaction dates, defaulting counts and any sync error; never prints
// credentials, payees or amounts. A partial failure (for example a SimpleFIN
// connection needing attention) still uploads the healthy accounts, prints
// the summary and exits 1 so the scheduler surfaces it. Exit codes: 1 sync,
// upload or owner defaulting failed, 2 environment not configured. The
// exported helpers are covered by tests; importing this module runs nothing.
import { basename, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';

// Household member recognized from a paying account's name; mirrors payerHint
// in app/src/server/ownership.ts. Keep the two in sync.
export function accountMember(name) {
  const match = /^(Michael|Liz|Joint)(?=$|[\s:._-])/i.exec(String(name).trim());
  return match ? match[1].toUpperCase() : null;
}

// Only leaf transactions are classifiable; Actual split parents are skipped,
// mirroring leaves() in app/src/server/ownership.ts.
export function isLeafTransaction(row) {
  return !row.is_parent && !(Array.isArray(row.subtransactions) && row.subtransactions.length > 0);
}

// Default metadata for leaf transactions whose account maps to a member.
// Unmapped accounts are counted so the operator can rename them in Actual.
export function defaultMetadataRows(transactions, accounts, defaultSplit) {
  const memberByAccount = new Map(accounts.map(account => [account.id, accountMember(account.name)]));
  const rows = new Map();
  let unmapped = 0;
  for (const transaction of transactions) {
    if (!isLeafTransaction(transaction)) continue;
    const member = memberByAccount.get(transaction.account);
    if (!member) { unmapped += 1; continue; }
    rows.set(transaction.id, {
      actual_transaction_id: transaction.id,
      expense_owner: member,
      payer: member,
      split_rule: member === 'JOINT' ? defaultSplit : null,
      notes: null,
      review_status: 'REVIEWED',
    });
  }
  return { rows: [...rows.values()], unmapped };
}

export async function readDefaultSplit(query) {
  const result = await query('SELECT default_joint_split FROM household_settings WHERE id = true');
  return result.rows[0]?.default_joint_split ?? null;
}

// Insert-only defaults; existing household metadata is never overwritten and
// repeated runs are idempotent.
export async function saveDefaultMetadata(query, rows) {
  let saved = 0;
  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    const params = [];
    const values = chunk.map((row, index) => {
      params.push(row.actual_transaction_id, row.expense_owner, row.payer, row.split_rule);
      const base = index * 4;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},'REVIEWED')`;
    });
    const result = await query(
      `INSERT INTO transaction_metadata (actual_transaction_id, expense_owner, payer, split_rule, review_status)
       VALUES ${values.join(',')} ON CONFLICT (actual_transaction_id) DO NOTHING RETURNING 1`,
      params,
    );
    saved += result.rows.length;
  }
  return saved;
}

async function applyOwnerDefaults(api, accounts, through, message) {
  if (!process.env.PGHOST || !process.env.PGDATABASE) {
    console.log('bank-sync: household metadata database not configured; owner defaults skipped');
    return;
  }
  const pool = new Pool({ max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  const query = (sql, params) => (params === undefined ? pool.query(sql) : pool.query(sql, params));
  try {
    const defaultSplit = await readDefaultSplit(query);
    const transactions = [];
    for (const account of accounts) {
      // Whole downloaded budget: covers SimpleFIN's own lookback and
      // pre-feature history; the per-account diagnostic stays 14 days.
      transactions.push(...await api.getTransactions(account.id, '2000-01-01', through));
    }
    const { rows } = defaultMetadataRows(transactions, accounts, defaultSplit);
    const saved = await saveDefaultMetadata(query, rows);
    console.log(`bank-sync: owner defaults saved for ${saved} new transaction${saved === 1 ? '' : 's'}`);
  } catch (err) {
    console.error(`bank-sync: owner defaulting failed: ${message(err)}`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main() {
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
  const api = await import('@actual-app/api');
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
    const accounts = await api.getAccounts();
    for (const account of accounts) {
      const transactions = await api.getTransactions(account.id, from, through);
      const latest = transactions.reduce((max, t) => (t.date > max ? t.date : max), '') || 'none';
      const unmapped = accountMember(account.name) ? '' : ', no household member prefix';
      console.log(`bank-sync: ${account.name}: ${transactions.length} rows ${from}..${through}, latest ${latest}${unmapped}`);
    }
    await applyOwnerDefaults(api, accounts, through, message);
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
}

// Tests import the helpers above; only a direct run starts a sync.
if (basename(process.argv[1] ?? '') === 'bank-sync.mjs') {
  main().catch(err => {
    console.error(`bank-sync: ${err && err.message ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
