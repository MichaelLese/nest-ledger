// Only the parent reads IPC; SDK logs never enter HTTP responses or application logs.
import * as api from '@actual-app/api';

try {
  await api.init({
    dataDir: process.env.ACTUAL_DATA_DIR,
    serverURL: process.env.ACTUAL_SERVER_URL,
    password: process.env.ACTUAL_SERVER_PASSWORD,
    verbose: false,
  });
  await api.downloadBudget(process.env.ACTUAL_SYNC_ID, {
    password: process.env.ACTUAL_BUDGET_PASSWORD || undefined,
  });
  const accounts = await api.getAccounts();
  const categories = await api.getCategories();
  const schedules = await api.getSchedules();
  const transactions = [];
  for (const account of accounts) {
    transactions.push(...await api.getTransactions(account.id, process.env.ACTUAL_START_DATE, process.env.ACTUAL_END_DATE));
  }
  await api.shutdown();
  process.send({ accounts, transactions, categories, schedules }, () => process.exit(0));
} catch {
  // The parent reports a sanitized error. Exit also releases partially initialized SDK state.
  process.exit(1);
}
