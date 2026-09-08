import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function readActualSummary(startDate, endDate) {
  for (const name of ['ACTUAL_SERVER_URL', 'ACTUAL_SERVER_PASSWORD', 'ACTUAL_SYNC_ID']) {
    if (!process.env[name]) throw new Error(`Actual is not configured: set ${name}.`);
  }
  const url = new URL(process.env.ACTUAL_SERVER_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('ACTUAL_SERVER_URL must be an HTTP(S) base URL without credentials.');
  }
  const dataDir = await mkdtemp(join(tmpdir(), 'nest-ledger-actual-'));
  try {
    return await new Promise((resolve, reject) => {
      const child = fork(fileURLToPath(new URL('./actual-worker.mjs', import.meta.url)), [], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        execArgv: [],
        env: { ...process.env, ACTUAL_DATA_DIR: dataDir, ACTUAL_START_DATE: startDate, ACTUAL_END_DATE: endDate },
      });
      let result;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 30_000);
      child.on('message', message => { result = message; });
      child.on('error', () => { /* close follows even if spawning fails */ });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0 && result) resolve(result);
        else reject(new Error(timedOut
          ? 'Actual request timed out. Check server connectivity and budget size.'
          : 'Actual could not be loaded. Check server connectivity, credentials, Sync ID and API/server version compatibility.'));
      });
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}
