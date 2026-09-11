# Task 116 month picker validation

Final gate reverified in the worktree `app/` workspace on 2026-09-11:

- `npm run typecheck`: exit 0, route types generated, zero TypeScript errors.
- `npm test`: exit 0, 26 passed, zero failed/skipped (all existing 25 plus
  the optional-range wrapper regression test).
- `npm run build`: exit 0, production webpack compilation and TypeScript
  validation successful, 5/5 static pages generated.
- Additional root `npm run test:actual`: exit 0, 3/3 passed, including sanitized
  failure/retry and hung-child termination at 30 seconds (30006 ms).
- `git diff --check`: passed.

The new wrapper test verifies the no-argument UTC month-through-today default,
explicit range forwarding, coalescing matching ranges, isolation between
concurrent month reads, fresh reads after completion, and retry after failure.
Calendar tests cover malformed values, leap days, year/month boundaries,
historical spending, unclassified ownership and split deduplication.

Reviewed the installed @actual-app/api 26.9.0 implementation: public
`getTransactions(accountId, startDate, endDate)` sends precisely those three
fields to its existing `api/transactions-get` handler. That handler applies
`date >= startDate` and `date <= endDate`, with grouped splits.
The integration worker and credential/timeout handling are unchanged.

Historical transaction review cards are read-only; metadata PUT continues to
validate against the no-argument current-month summary. Auth, bills, tagging,
and split behavior are unchanged. No new dependencies or infrastructure edits.
No live household credentials or live budget were used for these checks.

Historical editing supersedes the read-only choice above: see the current
ownership and Actual integration documentation for the month-scoped PUT contract.
