import { readActualSummary } from './actual-summary.mjs';
try {
  const today = new Date().toISOString().slice(0, 10);
  const summary = await readActualSummary(today.slice(0, 8) + '01', today);
  console.log(Object.fromEntries(Object.entries(summary).map(([key, list]) => [key, list.length])));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
