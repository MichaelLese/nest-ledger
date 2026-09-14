# Phase 4 ownership workflow

Actual remains the only ledger. The home page provides transaction tagging for
the **selected UTC calendar month**. The current month runs
through today; historical months cover the full calendar month. The month picker
retains its current-month upper limit. All months use the same transaction editor
and direct-save flow. No Actual mutation or bank-sync calls are added.
The existing read downloads a temporary Actual budget; it now also reads payee
names for transaction identification. Cards also show the Actual category
name, including hidden categories, with each split child using its own category.
Date, account, and any resolved category share one muted metadata line.
Missing or unresolved categories are omitted.

Each Actual transaction ID maps to one optional `transaction_metadata` row.
The scheduled bank sync saves each synced transaction immediately with the
paying account's household member (Michael/Liz/Joint account-name prefix) as
both expense owner and payer, status REVIEWED, with the household default
joint split for JOINT owners; existing rows are never overwritten (see
[Actual integration](actual-integration.md)). A Michael/Liz/Joint account
prefix therefore suggests the payer and, through this operator-approved
default, the initial expense owner; it can be overridden anytime. Accounts
without a member prefix stay unclassified until edited. Absent rows display
no owner and never write metadata on read.

There is no review queue or review status in the UI. Every transaction for the
month appears in one list, and the MICHAEL / LIZ / JOINT buttons in each card
save the expense owner directly — no confirm or mark-reviewed gate. The card
displays the payer (from the saved row or the account hint) as read-only text.
Each card has an Advanced disclosure, closed by default, for overriding the
payer, editing household notes, and, for JOINT owners only, choosing a split
rule and viewing its preview; Advanced has its own Save button, which saves
directly like the owner buttons. The account-name payer hint also appears
inside Advanced. On desktop, the compact header keeps the amount beside the
description and a secondary Advanced button; expense-owner buttons and the
payer share a row. Narrow screens retain larger controls and stack the owner
label above its buttons. Saved payer overrides take precedence over account
hints. Saving requires an expense owner only; a payer can stay unset for
accounts without a hint and be added later. JOINT saves require an existing
`split_rules` rule, preselected from `household_settings.default_joint_split`.
Either spouse can edit all household rows; simultaneous saves use
last-write-wins. The ALL | MICHAEL | LIZ | JOINT filter uses saved expense
ownership, so unowned rows appear only under ALL. Refresh reloads the view
and discards unsaved edits.

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
tests exercise hint boundaries, invalid owner/split payloads, signed rounding,
Actual split handling, session/password/origin checks, repository SQL against
embedded PostgreSQL using the unchanged migrations, and the bank-sync owner
defaulting helpers (payer-hint parity, leaf filtering, insert-only defaults,
idempotency and chunking). Actual SDK failure/retry and
30-second timeout tests use a local fake server and no real budget credentials.
These tests do not establish browser or live service acceptance.

After PR review and a separately authorized future test deployment, the operator
still needs to check:

- Michael and Liz login, incorrect password, logout, expiry, Secure cookie flags,
  and unauthenticated denial of both financial endpoints over private HTTPS.
- Desktop and narrow mobile layout, keyboard navigation, readable labels, loading,
  empty/error states, and retention of an unsaved draft after a failed save.
- Real Actual payee/account/date/amount display and split child rows, with no
  parent duplication. Confirm month navigation and historical save persistence.
- Bank-sync defaults: after a scheduled sync run, transactions on
  Michael/Liz/Joint-prefixed accounts show that member as owner and payer with
  no review state; accounts without a prefix stay unclassified and are flagged
  in the sync output.
- Inline editing: change the expense owner from the list, change the payer or
  notes in Advanced, refresh, and confirm both persist without any confirm
  gate. A defaulted owner can be overridden at any time.
- All four global filters; unknown owners remain in ALL.
- JOINT 50/50 preview, odd-cent/refund rounding, personal owner clearing the rule,
  and persistence across app restart. Verify Actual transaction data is unchanged.

Reconciliation, backups, rule editing, OIDC and
infrastructure work remain outside this implementation. Phase 5 bills are
described below.

## Phase 5 monthly summary

The existing authenticated `GET /api/ownership` response adds a `summary` key
with `from` / `through` UTC dates, `owners` (MICHAEL, LIZ, JOINT, UNCLASSIFIED),
and `topCategories` (up to eight `{ id, name, amount }` rows). Existing metadata
fields and writes retain their contracts. The summary reuses the same Actual
read and metadata query; no additional ledger or database writes are introduced.
Amounts are positive integer Actual minor units representing **gross spending**:
negative leaf transactions only, excluding linked transfers (`transfer_id`).
Income, refunds, and zero amounts are excluded rather than netted against spend.
The range is the selected UTC calendar month, inclusive, ending today for the current month.

Saved expense ownership determines the bucket;
missing/null owners are Unclassified. The summary never assigns ownership from
account names or payer tags; bank-sync defaults are ordinary saved rows by
summary time. JOINT remains its own bucket, with no allocation to personal totals.
Actual split children count once via `leaves()`; parents are excluded.
Categories aggregate across all owners by Actual category ID, including hidden
categories. Missing categories display as Uncategorized; unresolved IDs display
as Unknown category. Ordering is descending spend, then name and ID for ties.

The section below the transaction list always shows the whole household,
independent of owner filters. Successful tagging updates owner cards immediately from saved
rows; Refresh reloads the full summary. Currency uses household settings and the
existing minor-unit formatter. This slice adds no charts or dependencies.

## Phase 5 bills surface

`GET /api/ownership` adds `bills`, matching Actual schedules to household metadata
by `actual_schedule_id`. Upcoming bills appears below the monthly summary and
shows all household schedules independently of transaction owner filters. Empty
schedules show “No schedules configured in Actual yet.” Unnamed schedules and
missing dates/responsibility have explicit placeholders.

The pinned Actual API 26.9.0 `scheduleModel.toExternal` exposes `name`, `next_date`
and `amount`, not `next_amount`. Numeric integer amounts (including zero) retain
Actual's sign in the payload and display as positive obligations on bill cards. Missing or range amounts show
“No fixed amount available”; no midpoint, next amount or recurrence date is
calculated. Cards sort by `next_date` ascending with missing dates last. UTC calendar dates
before today show a red “overdue” badge; today through seven days ahead show an
amber “due in N d” badge. Later or missing dates have no urgency badge. No local
recurrence dates or completion filter are added.

The pinned SDK also exposes `account`, passed unchanged through the summary
worker. Bills resolve that ID against summary accounts to display the paying
account name; missing or unresolved IDs show “Source: Actual schedule · Paying
account unavailable”. Account names never assign responsibility. Assigned cards
load in display mode with the saved responsible member as a chip
and an autopay status pill. Edit opens the responsibility choices, autopay checkbox,
and Save button. Unassigned cards initially open in edit mode to make assignment
obvious. Successful saves return to display mode with updated values and an Edit
button; Save appears only in edit mode. Saving without assigning a member shows a
muted “Unassigned” chip. Selection changes remain drafts until Save succeeds.

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
