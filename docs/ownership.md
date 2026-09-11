# Phase 4 ownership workflow

Actual remains the only ledger. The home page provides transaction tagging and a
review queue for the **current UTC calendar month through today**. Older dates
are not included in this phase. No Actual mutation or bank-sync calls are added.
The existing read downloads a temporary Actual budget; it now also reads payee
names for transaction identification. Review cards also show the Actual category
name, including hidden categories, with each split child using its own category.
Date, account, and any resolved category share one muted metadata line alongside
a compact review-status badge. Missing or unresolved categories are omitted.

Each Actual transaction ID maps to one optional `transaction_metadata` row.
Absent rows have NEEDS_REVIEW status with no saved owner or payer. A Michael/Liz/Joint
account prefix suggests the **payer only**; it never determines expense ownership
or writes metadata on read. Select the expense owner explicitly with the MICHAEL / LIZ / JOINT buttons.
The card prefills an unset payer from the account hint and displays it as read-only
text. Each card has an Advanced disclosure, closed by default, for overriding the
payer, editing household notes, and, for JOINT owners only, choosing a split rule
and viewing its preview. The account-name payer hint also appears inside Advanced.
On desktop, the compact header keeps the amount beside the description and a
secondary Advanced button; expense-owner buttons and the payer share a row.
Narrow screens retain larger controls and stack the owner label above its buttons.
Saved payer overrides take precedence over account hints. “Save for review”
persists the draft as NEEDS_REVIEW; “Confirm and mark reviewed” requires both owner
and payer and saves REVIEWED. Editing a reviewed row and saving for review reopens
it. Either spouse can edit all household rows; simultaneous saves use last-write-wins.
The ALL | MICHAEL | LIZ | JOINT filter uses saved expense ownership, so untagged
rows appear only under ALL. Refresh reloads the view and discards unsaved edits.

JOINT expenses require an existing `split_rules` rule, preselected from
`household_settings.default_joint_split`. The app stores only its ID. Existing
`me_percentage` / `wife_percentage` columns mean Michael / Liz. The preview
allocates signed integer minor units: round Michael's absolute share to nearest
minor unit (halves up), give Liz the remainder, then preserve the original sign.
No allocation amounts are persisted. Changing a rule externally changes previews
for all rows referencing it; rule administration is outside this phase.
Actual split parents are excluded and children are classified by their existing
IDs, preserving Actual splits without double counting. Unsplit rows remain intact.

## Authentication configuration for a future deployment

There are two password logins, MICHAEL and LIZ, checked against the corresponding
`household_members.type` row. JOINT cannot log in. No new schema is required;
001 and 002 must already have been applied. The app uses existing PGHOST, PGPORT,
PGDATABASE, PGUSER and PGPASSWORD environment variables through a bounded pool.

Supply these server-only environment variables through protected configuration:

- `AUTH_ORIGIN`: exact browser origin, e.g. `https://nest-ledger.tailcc818c.ts.net`
  (no trailing slash). Unsafe requests must carry that Origin; missing or different
  origins are rejected, including login/logout. Local dev can use
  `http://127.0.0.1:3000`.
- `AUTH_SESSION_SECRET`: at least 32 random characters, shared by the app process.
  Generate with `openssl rand -hex 32`. Rotate to invalidate all sessions.
- `AUTH_MICHAEL_PASSWORD_HASH` and `AUTH_LIZ_PASSWORD_HASH`: scrypt hashes generated
  using the helper below, each with its own random salt. Never use raw passwords.

In an interactive Bash terminal, generate each hash without putting the password
in history or process arguments:

```bash
read -r -s -p 'Password (12+ characters): ' household_password
printf '%s' "$household_password" | node app/scripts/password-hash.mjs
unset household_password
```

Store the resulting hash in protected configuration, never Git. Login is
fail-closed when configuration is missing. Cookies are signed, HttpOnly,
SameSite=Strict, expire after 12 hours, and are Secure in production. Local
Next development permits HTTP cookies on loopback. Logout clears the browser
cookie; a copied signed cookie remains usable until expiry or secret rotation.
Ten attempts per member per 15 minutes are allowed in memory; restart resets
this limit. This is intended for the existing private single-process household
service. Password changes alone do not invalidate issued cookies.

Both `/api/ownership` and `/api/actual/summary` now require login. `/api/health`
remains public process liveness. Protected responses use `Cache-Control: no-store`.
CLI `npm run actual:smoke` remains a credentialed local operator tool.

**Deployment configuration:** `infrastructure/compose.yaml` forwards all four
AUTH variables to the web process with `${VAR:-}` empty defaults. Set them in the
protected `infrastructure/.env` on the deployment host and pass that file using
Compose's `--env-file` option. With these variables unset in local development,
authentication remains unconfigured and login fails closed. Keep secrets out of
Git and keep the private HTTPS/LAN/VPN controls in place.

## Validation and operator acceptance

`npm run typecheck`, `npm test`, and `npm run build` validate the app. Behavioral
tests exercise hint boundaries, invalid review/split payloads, signed rounding,
Actual split handling, session/password/origin checks, and repository SQL against
embedded PostgreSQL using the unchanged migrations. Actual SDK failure/retry and
30-second timeout tests use a local fake server and no real budget credentials.
These tests do not establish browser or live service acceptance.

After PR review and a separately authorized future test deployment, the operator
still needs to check:

- Michael and Liz login, incorrect password, logout, expiry, Secure cookie flags,
  and unauthenticated denial of both financial endpoints over private HTTPS.
- Desktop and narrow mobile layout, keyboard navigation, readable labels, loading,
  empty/error states, and retention of an unsaved draft after a failed save.
- Real Actual payee/account/date/amount display and split child rows, with no
  parent duplication. Confirm only the current month appears.
- A paying-account hint never sets the expense owner or resolves review. Save
  differing owner/payer values, refresh, confirm review, then reopen it.
- All four global filters and the review-only toggle; unknown owners remain in ALL.
- JOINT 50/50 preview, odd-cent/refund rounding, personal owner clearing the rule,
  and persistence across app restart. Verify Actual transaction data is unchanged.

Reconciliation, backups, historical browsing, rule editing, OIDC and
infrastructure work remain outside this implementation. Phase 5 bills are
described below.

## Phase 5 monthly summary

The existing authenticated `GET /api/ownership` response adds a `summary` key
with `from` / `through` UTC dates, `owners` (MICHAEL, LIZ, JOINT, UNCLASSIFIED),
and `topCategories` (up to eight `{ id, name, amount }` rows). Existing review
fields and writes retain their contracts. The summary reuses the same Actual
read and metadata query; no additional ledger or database writes are introduced.
Amounts are positive integer Actual minor units representing **gross spending**:
negative leaf transactions only, excluding linked transfers (`transfer_id`).
Income, refunds, and zero amounts are excluded rather than netted against spend.
The range is the current UTC calendar month through today, inclusive.

Saved expense ownership determines the bucket regardless of review status;
missing/null owners are Unclassified. Account names and payer tags never assign
ownership. JOINT remains its own bucket, with no allocation to personal totals.
Actual split children count once via `leaves()`; parents are excluded.
Categories aggregate across all owners by Actual category ID, including hidden
categories. Missing categories display as Uncategorized; unresolved IDs display
as Unknown category. Ordering is descending spend, then name and ID for ties.

The section below the review queue always shows the whole household, independent
of review filters. Successful tagging updates owner cards immediately from saved
rows; Refresh reloads the full summary. Currency uses household settings and the
existing minor-unit formatter. This slice adds no charts or dependencies.

## Phase 5 bills surface

`GET /api/ownership` adds `bills`, matching Actual schedules to household metadata
by `actual_schedule_id`. Upcoming bills appears below the monthly summary and
shows all household schedules independently of transaction review filters. Empty
schedules show “No schedules configured in Actual yet.” Unnamed schedules and
missing dates/responsibility have explicit placeholders.

The pinned Actual API 26.9.0 `scheduleModel.toExternal` exposes `name`, `next_date`
and `amount`, not `next_amount`. Numeric integer amounts (including zero) retain
Actual's sign and display as schedule amounts. Missing or range amounts show
“No fixed amount available”; no midpoint, next amount or recurrence date is
calculated. This surface lists the schedules returned by Actual without a local
due-soon calculation or completion filter.

Each card saves responsibility (MICHAEL/LIZ/JOINT) and an autopay reminder through
`PUT /api/ownership/bills`, with the existing session and origin checks. The server
validates the payload and checks that the schedule still exists in a fresh Actual
summary before upserting only its household bills row. It uses the Actual name
for the required name snapshot, resolves member type to the existing UUID foreign
key, and preserves all other bill metadata. Autopay is a household annotation;
it does not enable Actual posting or bank payments. Failed saves retain drafts.
Refresh discards drafts. No Actual writes or schema changes are introduced.

Operator acceptance after a separately authorized deployment should cover an
empty schedule list, a named schedule with a date/amount, missing optional fields,
responsibility/autopay persistence after refresh, and mobile/keyboard controls.
