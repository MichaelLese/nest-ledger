# Phase 4 ownership workflow

Actual remains the only ledger. The home page provides transaction tagging and a
review queue for the **current UTC calendar month through today**. Older dates
are not included in this phase. No Actual mutation or bank-sync calls are added.
The existing read downloads a temporary Actual budget; it now also reads payee
names for transaction identification.

Each Actual transaction ID maps to one optional `transaction_metadata` row.
Absent rows display as NEEDS_REVIEW with no owner or payer. A Michael/Liz/Joint
account prefix suggests the **payer only**; it never determines expense ownership
or writes metadata on read. Select the expense owner explicitly. “Save for review”
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

**Deployment prerequisite:** this task does not change Compose or deploy anything.
The existing Compose environment does not forward these AUTH variables. A future,
separately authorized deployment must wire all four into the web process before
login works. Keep the private HTTPS/LAN/VPN controls in place.

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

Bills, schedules, dashboards, reconciliation, backups, historical browsing, rule
editing, OIDC and infrastructure work are outside this implementation.
