#!/usr/bin/env bash
# Run on agent-hub as agent; never enable shell tracing.
# Triggers the scheduled SimpleFIN bank sync on the nest-ledger CT through
# the nest-ledger-web container, where Compose injects the protected Actual
# environment. The compose cp step refreshes the in-container copy so the
# timer keeps working across container recreation and image rebuilds.
# The script prints per-account row counts, latest dates and any per-account
# bank-sync error; it exits 1 when at least one account failed.
set -euo pipefail
ssh -o BatchMode=yes nest-ledger 'bash -se' <<'REMOTE'
set -euo pipefail
cd /opt/nest-ledger
compose() { docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml "$@"; }
compose cp app/scripts/bank-sync.mjs nest-ledger-web:app/app/scripts/bank-sync.mjs
compose exec -T -u node nest-ledger-web node app/scripts/bank-sync.mjs
REMOTE
