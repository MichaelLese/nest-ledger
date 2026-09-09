# Actual integration (Phase 2 session scope)

Actual remains the ledger. This groundwork follows build-plan sections 2, 5 and
13; the PDF calls API/schema work Phase 3. This session's explicitly requested
Phase 2 scope includes these foundations, without authentication or household UI.

## Connect a real budget

Use Node 22. Create one shared household budget in Actual, configure categories,
schedules and account names there, and verify SimpleFIN synchronization there.
Copy `infrastructure/.env.example` to `infrastructure/.env`, chmod 600, then set:

- `ACTUAL_SERVER_URL`: host CLI base URL, normally `http://127.0.0.1:5006`.
  Compose supplies `http://actual-server:5006` to the app instead. For a remote
  server use its trusted HTTPS URL, without credentials or an `/api` suffix.
- `ACTUAL_SERVER_PASSWORD`: Actual **server login password**.
- `ACTUAL_SYNC_ID`: Settings → Advanced → Sync ID, not the local budget ID.
- `ACTUAL_BUDGET_PASSWORD`: only if end-to-end encryption is enabled; this is
  the separate budget encryption password, not the server password.

Use single-quoted values in the env file for passwords containing `$` or `#`;
never put passwords in URLs, command arguments, Git, or `NEXT_PUBLIC_*` variables.
Environment variables override the CLI env file. An OIDC-only server needs a
compatible Actual API/password authentication setup; a browser session is not
an API credential. See the official [API guide](https://actualbudget.org/docs/api/)
and [reference](https://actualbudget.org/docs/api/reference/).
The API is pinned to 26.9.0; select a matching tested server release using
`ACTUAL_VERSION` before deploying. Cross-version compatibility is not assumed.

From the repository root:

```sh
npm ci
npm run actual:smoke
# Credential-free SDK failure/retry/timeout tests (about 30 seconds):
npm run test:actual
# Prints only account/transaction/category/schedule counts, never finance rows.
# For development, load the same protected env file:
node --env-file=infrastructure/.env node_modules/next/dist/bin/next dev app --hostname 127.0.0.1
```

After changing Compose credentials, recreate the web service:

```sh
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml up -d --build nest-ledger-web
curl -i http://127.0.0.1:3000/api/actual/summary
```

The internal GET endpoint returns `accounts`, `transactions`, `categories` and
`schedules`. Transactions cover the current UTC calendar month through today,
inclusively, across all returned accounts; other lists are complete. Amounts
retain Actual's integer representation and transaction splits remain intact.
There are no ledger mutation or bank-sync calls. The SDK downloads a temporary
local budget (required by Actual's architecture), removed after each request.
It is not written to PostgreSQL. SDK shutdown may perform its normal sync, but
this integration makes no edits. Concurrent requests share one in-flight read.
A child process bounds SDK failures/hangs to 30 seconds and keeps SDK diagnostics
out of HTTP responses and app logs. Large budgets may exceed that limit. Each
request downloads afresh; this is a diagnostic foundation, not a polling feed.
Temporary budget data is sensitive; protect the host and its temporary storage.
An abruptly killed parent/host can leave `nest-ledger-actual-*` temp directories;
remove these only when no reads are running.

Missing configuration, connection/authentication errors and timeouts produce
sanitized HTTP 503 JSON; `/api/health` remains a liveness check. Responses use
`Cache-Control: no-store`. No application authentication exists yet: keep this
financial-data endpoint behind the existing proxy access controls and LAN/VPN.

## PostgreSQL metadata

Apply the numbered SQL migration **once**, to the household database:

```sh
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' \
  < infrastructure/migrations/001_household_metadata.sql
```

The migration runs atomically and deliberately fails on reapplication. Apply
future numbered migrations in order; back up first. It is not applied silently
at application startup and works with existing Compose volumes. PostgreSQL
remains unpublished on the internal database network.

The five tables mirror section 5. Members include a JOINT household identity;
owner and payer are independent, nullable until classified. Actual IDs are text
references, not cross-database foreign keys. Schedule references are mandatory
and unique. Bill category/account IDs and optional amount/frequency/due-date
fields are display snapshots only: Actual remains authoritative, and future
bill views must read schedules rather than calculate recurrence from these fields.
No transaction amounts, balances, accounts or financial history are stored here.

The singleton settings row defaults to USD, Etc/UTC, month start 1 and a 50/50
split; change these for the household. Month start is limited to 1–28 so it exists
in every month. Split rules currently represent percentages totaling 100.
Custom dollar allocation needs a later metadata extension and reconciliation
implementation; it is not represented as a second ledger. Review and ownership
workflows, schedule snapshot refresh, authentication, and live synchronization
acceptance remain subsequent work. Switching to a different Actual budget needs
a separate metadata database or explicit metadata reset/migration.
