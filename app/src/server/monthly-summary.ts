import type { Metadata, Summary } from './ownership';
import { spendingSummary } from './spending';

export { monthRange } from './month-range';

export function monthlySummary(actual: Summary, metadata: Metadata[], through = new Date().toISOString().slice(0, 10)) {
  const from = through.slice(0, 8) + '01';
  const { owners, categories } = spendingSummary(actual, metadata, { from, through });
  return { from, through, owners, topCategories: categories.slice(0, 8) };
}

export type MonthlySummary = ReturnType<typeof monthlySummary>;
