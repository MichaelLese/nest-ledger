#!/usr/bin/env bash
# Run on agent-hub as agent; never enable shell tracing.
set -euo pipefail
umask 077
root="${NEST_BACKUP_ROOT:-$HOME/backups/nest-ledger}"
mkdir -p "$root"
chmod 700 "$root"
exec 9>"$root/.lock"
flock -n 9
stamp=$(date -u +%Y%m%dT%H%M%SZ)
stage=$(mktemp -d "$root/.partial.XXXXXX")
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT
ssh -o BatchMode=yes nest-ledger 'bash -se' > "$stage/postgres.dump" <<'REMOTE'
cd /opt/nest-ledger
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'
REMOTE
# Stop Actual for a consistent volume copy; restart even if tar fails.
ssh -o BatchMode=yes nest-ledger 'bash -se' > "$stage/actual-data.tar.gz" <<'REMOTE'
set -euo pipefail
cd /opt/nest-ledger
compose() { docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml "$@"; }
trap 'compose start actual-server >&2' EXIT
compose stop actual-server >&2
volume=$(docker volume inspect nest-ledger_actual-data --format '{{.Mountpoint}}')
tar -C "$volume" -czf - .
REMOTE
ssh -o BatchMode=yes nest-ledger 'cd /opt/nest-ledger && tar -czf - infrastructure .dockerignore package.json package-lock.json' > "$stage/config.tar.gz"
ssh -o BatchMode=yes nest-ledger 'tailscale serve status --json' > "$stage/tailscale-serve.json"
# Validate archives without exposing their contents.
gzip -t "$stage/actual-data.tar.gz" "$stage/config.tar.gz"
ssh -o BatchMode=yes nest-ledger 'cd /opt/nest-ledger && docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml exec -T postgres pg_restore --list >/dev/null' < "$stage/postgres.dump"
(cd "$stage" && sha256sum postgres.dump actual-data.tar.gz config.tar.gz tailscale-serve.json > SHA256SUMS)
mv "$stage" "$root/$stamp"
printf 'Backup complete: %s\n' "$root/$stamp"
# No automatic deletion: retain daily copies, including weekly/monthly points.
