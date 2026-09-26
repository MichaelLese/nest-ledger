# Category spending

The approved category experience supersedes the PDF's single-choice global filter
and earlier category-card behavior. Actual remains the sole financial ledger.
This feature adds visualization reads only; transaction editing retains the existing
household metadata save path. No schema changes or financial writes are required.

## Ownership and amounts

MICHAEL, LIZ (Elizabeth), and JOINT are independent expense ownership toggles.
The first tap selects/highlights a member; another tap removes that member. Any
combination applies to the monthly spending total, category chart/list, category
detail, history and transactions. All household clears the selection; removing
the final selection also restores All household. This includes unclassified rows.
Selecting all three members includes only classified rows. Payer, account names,
and bill responsibility never assign expense ownership in this visualization.
JOINT remains a separate bucket, without splitting its spend into personal totals.
Upcoming bills remains explicitly labeled as all-household Actual schedules because
its responsibility field is independent of transaction expense ownership.

Amounts are positive integer minor-unit **gross spending**, derived from negative
Actual leaf transactions only. Linked transfers, income, refunds and zeros do not
contribute. Split children count once using their own category ID and saved owner;
parents are excluded. The general transaction editor still includes income, refunds
and transfers under the same ownership scope. Category detail lists only the spending
transactions contributing to its amount, so its rows add up to the displayed total.

Categories group by Actual category ID, including hidden categories; identical names
remain separate. Null/empty IDs map to Uncategorized; unresolved nonempty IDs display
Unknown category and remain separately addressable. Ties sort by spend descending,
then name, then ID. Successful metadata saves recalculate the active scope immediately.

## Overview and detail

- Default: **Donut**, **Top 8**. Show exactly the first eight nonzero categories,
  or fewer when fewer exist. Do not expand ties or add an Other category.
- Every slice and percentage uses the full active scope total. Spend outside Top 8
  remains an unfilled part of the ring, with its amount labeled above the chart.
- **All nonzero categories** reveals every nonzero category. It is a view state,
  not a household setting or stored preference.
- Selecting a slice or its labeled row makes that category primary and rotates its
  midpoint to the bottom. The center shows its amount for the selected month and
  percentage of the full scope. It opens category detail. The largest visible
  category is initially selected; if the selection leaves the visible set, the
  largest remaining category becomes primary.
- **Ranked list** works independently of the donut. Each row directly opens detail.
  Rows show rank, name, amount, proportion bar and percentage; transaction count is
  omitted from these primary rows.
- Detail shows six monthly historical bars for the same Actual category ID and
  ownership combination, ending with the selected month. Earlier months are complete
  UTC calendar months; the current month ends today. Months with no spend show zero.
  Longer history is deferred. At the earliest supported year (0001), only available
  calendar months are returned.
- Included transactions belong to the selected month, exact category ID and expense
  ownership combination. They show the saved owner separately from payer/account.
  Detail itself is read-only; use Back to categories for the existing transaction
  editor. The explicit Back button returns focus to the category heading.

The history route accepts exactly one `month` and `category` query value. Empty
`category=` denotes Uncategorized. Optional repeated `owner` values accept the
three member IDs without duplicates. Invalid/duplicate values or future months
return 400 before reading Actual. Authentication precedes reads; responses are
no-store. The server uses one six-month Actual read and one metadata SELECT and
returns `{ bars: [{ from, through, amount }] }`. Read failures are sanitized and
retryable. Changing month, category or owners cancels the obsolete browser request;
its result cannot replace the new view. No history is fetched until detail opens.
The open month's bar uses the same current saved rows as its included transactions.

## Installed PWA and accessibility

The manifest and Apple web-app metadata support standalone launch, with local
192/512px icons and a 180px Apple touch icon (source: `app/public/icon.svg`). Viewport-fit and safe-area padding
protect content from the iOS notch and home indicator. Controls wrap at narrow
widths, avoid hover dependencies, and provide at least 44px targets on touch devices.
The labeled rows provide large targets for categories whose slices are tiny.
History bars become horizontal on narrow screens so currency labels remain readable.
Browser zoom remains enabled. No financial data is stored for offline use, and no
service worker is registered; history requires a connection.

Owner selection, Top 8/all mode, donut/list, and detail are in memory only. In-app
month changes and Refresh retain these controls; Refresh fetches fresh data and
discards transaction drafts. Full reload, a new window, sign-out/relaunch or iOS
process eviction starts at the current UTC month, All household, Donut, Top 8 and
overview. Merely backgrounding a live window retains its state; use Refresh for
updated data on return. There is no localStorage/sessionStorage preference.

Both list and donut controls are keyboard-operable and have semantic labels.
Buttons expose pressed state; scope and selected-category changes announce their
state. Detail navigation moves focus to its heading. Bars expose month/amount text
without relying on color, hover or tooltips. Focus indicators remain visible and
`prefers-reduced-motion` removes rotation animation; rotation never blocks access.

## Validation

Run `npm test`, `npm run build`, and `git diff --check`. This repository has no
configured lint or formatter script. Browser tests use the actual client components
and compiled app CSS with synthetic API responses; they do not contact a database,
Actual, auth service or bank. Run:

```sh
# Keep browser binaries local to this worktree if required by task policy.
PLAYWRIGHT_BROWSERS_PATH="$PWD/.validation/browsers" npx playwright install chromium webkit
PLAYWRIGHT_BROWSERS_PATH="$PWD/.validation/browsers" npm run test:browser
```

The browser fixture is test-only and never registers an application route or auth
bypass. Unit/route tests cover owner combinations, gross-spend semantics, categories,
month bounds, history authentication/validation and read-only behavior. Browser
checks cover selection, detail, reload, narrow layout, keyboard, reduced motion and
history errors in desktop Chromium and iPhone-emulated WebKit when available.

Before deployment acceptance, the operator should still verify the installed app
on a physical iPhone over the existing private HTTPS service: Add to Home Screen,
standalone launch/icon, notch/home-indicator clearance, touch and VoiceOver reading
order, landscape, zoom, background/resume, reload/process eviction and safe focus
movement. Browser emulation does not establish physical-device acceptance. Review
and separate deployment authorization are required; this task does not deploy.
