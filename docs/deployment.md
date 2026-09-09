# CT 116 deployment and recovery

Deployed on 2026-09-09 from application commit
`14dfaf0e7827e7f80a1f847fb9f0ca9a6da0b30c`, using the recorded
`rotom/116-phase1-deploy` worktree. This follows the 2026-09-09 Codex planning
consult: deployment only; Actual remains the ledger; budget creation and
SimpleFIN are separate operator work. No Actual credentials or bank data were
configured.

## Verified target and access

CT 116 is `nest-ledger`, Debian **12** (the getting-started target is Debian 13),
4 GB RAM, 512 MB swap, 32 GB disk; Docker 29.8.0 and Compose v5.5.1.
The repository is at `/opt/nest-ledger`. PostgreSQL is unpublished on the internal
Docker network; web and Actual bind to loopback only.

- Web: https://nest-ledger.tailcc818c.ts.net/
- Actual: https://nest-ledger.tailcc818c.ts.net:8443/

Tailscale Serve is persistent, HTTPS-only and tailnet-only; Funnel is disabled.
There is no custom app authentication yet: tailnet policy must restrict access
to the household. Both HTTPS endpoints returned 200 from agent-hub after initial
certificate issuance. On the CT, `/etc/hosts` resolves its own FQDN to 127.0.1.1;
use `curl --resolve nest-ledger.tailcc818c.ts.net:443:100.109.28.119` for a local
HTTPS check. Normal tailnet clients use MagicDNS.

From the CT, configure the existing private routes with:

```sh
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve --bg --https=8443 http://127.0.0.1:5006
tailscale serve status --json
```

## Deployment evidence

The worktree was copied by rsync excluding `.git`, `node_modules`, `.next` and
`infrastructure/.env`. The CT needed rsync installed first. Its env was created
exclusively with mode 600, a cryptographically random PostgreSQL password and
`ACTUAL_VERSION=26.9.0`. Actual credential fields remain empty.
Compose `config --quiet` passed. Never run an unredacted Compose config or
container environment inspection in logs.

The web image was built before startup using a dedicated BuildKit container:

```sh
cd /opt/nest-ledger
docker buildx create --name nest-ledger-build --driver docker-container \
  --driver-opt memory=3g,memory-swap=3g
# For subsequent builds reuse this builder; do not create it again.
docker buildx build --builder nest-ledger-build --load \
  -t nest-ledger-nest-ledger-web -f infrastructure/Dockerfile .
docker buildx stop nest-ledger-build
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml up -d --no-build
```

Build, TypeScript checks and image load passed; builder memory limit was
3221225472 bytes and `OOMKilled=false`. No pruning or design changes were needed.
After PostgreSQL became healthy, the public schema had zero tables. The exact
ON_ERROR_STOP command in [Actual integration](actual-integration.md) applied
migration 001 with BEGIN/COMMIT, five tables, and seed counts of three members,
one split rule and one settings row. Unconditional CREATE TABLE statements make
reapplication fail; it was **not** run a second time.

Verbatim loopback smoke output, also repeated after web-only restart:

```text
{"status":"ok"}
HTTP 200
{"error":"Actual is not configured: set ACTUAL_SERVER_PASSWORD."}
HTTP 503
```

`compose restart nest-ledger-web` preserved the PostgreSQL and Actual container
IDs, start times and named volume assignments, plus hashes of seeded household
member/settings rows. Neither database nor Actual was restarted by this check.
This verifies the requested web restart; a full CT reboot/restore drill has not
been performed.

## Off-CT backups

Agent-hub runs [backup-agent-hub.sh](../infrastructure/backup-agent-hub.sh) as
`agent`, installed at `/home/agent/.local/bin/nest-ledger-backup`. The systemd
user timer `nest-ledger-backup.timer` runs daily at **03:15 UTC**, with
`Persistent=true`; user lingering is enabled. It uses the existing SSH alias
`nest-ledger`. A lock prevents overlapping executions.

Backups are outside CT 116 at `/home/agent/backups/nest-ledger/<UTC timestamp>/`:

- `postgres.dump`: PostgreSQL custom-format pg_dump, not a live directory copy.
- `actual-data.tar.gz`: complete Actual volume, copied while Actual is stopped;
  an exit trap restarts Actual on ordinary backup failure as well as success.
- `config.tar.gz`: infrastructure including protected `.env`, lockfile, package
  manifest and Docker ignore configuration.
- `tailscale-serve.json` and `SHA256SUMS`.

The first backup, `20260909T155939Z`, completed successfully. Archive gzip and
pg_restore TOC checks passed. Root backup directory and snapshot directories
are mode 700; files are mode 600, owned by agent. These backups use the task's
permitted **permission protection**, not encryption at rest. Do not copy them
to shared storage without encryption. The same-host agent account and root can
read them. All daily copies are retained, including weekly/monthly points;
monitor disk usage and introduce explicit retention before pruning. Proxmox/PBS
backups and an isolated restore drill remain separate infrastructure follow-up.
The repository's broader encrypted/PBS backup policy is not fully implemented
by this initial permission-protected backup.

Check or run backups on agent-hub:

```sh
systemctl --user list-timers nest-ledger-backup.timer
systemctl --user start nest-ledger-backup.service
journalctl --user -u nest-ledger-backup.service -n 30
```

To reinstall, install the script mode 700 and create these units under
`/home/agent/.config/systemd/user/` (the agent user must have lingering enabled):

```ini
# nest-ledger-backup.service
[Unit]
Description=Nest Ledger off-CT backup
[Service]
Type=oneshot
UMask=0077
ExecStart=/home/agent/.local/bin/nest-ledger-backup
TimeoutStartSec=30min
```

```ini
# nest-ledger-backup.timer
[Unit]
Description=Daily Nest Ledger backup
[Timer]
OnCalendar=*-*-* 03:15:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
```

Then run `systemctl --user daemon-reload` and
`systemctl --user enable --now nest-ledger-backup.timer`.
An interrupted SSH session or host failure may defeat the remote exit trap;
check Actual is running after any failed backup and restart it if needed.

## Restore into an isolated replacement CT

Use a fresh CT with no production routes or bank connectivity. Do not run these
commands against the live deployment or reuse its existing volumes. Retrieve the
application commit above from Git into `/opt/nest-ledger`, and securely transfer
one entire snapshot from agent-hub to `/root/nest-restore` (mode 700). Keep all
restored files protected; do not print or commit `.env`.

Run as root on that isolated CT:

```sh
set -eu
umask 077
cd /root/nest-restore
sha256sum -c SHA256SUMS
cd /opt/nest-ledger
tar -xzf /root/nest-restore/config.tar.gz
chmod 600 infrastructure/.env
compose() { docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml "$@"; }
compose config --quiet
compose up -d postgres
# Wait until this reports healthy before proceeding:
docker inspect nest-ledger-postgres-1 --format '{{.State.Health.Status}}'
```

Once healthy, restore the dump into the fresh database. **Do not apply migration
001 first**: the dump already includes its schema and seed data.

```sh
compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --exit-on-error --single-transaction' \
  < /root/nest-restore/postgres.dump
compose create actual-server
volume=$(docker volume inspect nest-ledger_actual-data --format '{{.Mountpoint}}')
tar -xzf /root/nest-restore/actual-data.tar.gz -C "$volume"
# Build the web image with the bounded builder instructions above.
# Before starting web, clear Actual credentials in the isolated env so the
# restore drill cannot sync any real budget. Keep the original archive intact.
compose up -d --no-build
compose ps
curl --fail http://127.0.0.1:3000/api/health
```

Verify five metadata tables and expected rows, and inspect Actual via an isolated
HTTPS route before any promotion. On a future real-data restore, verify the
operator's known budget/account totals without bank synchronization. Recreate
Serve only after deliberate cutover, using the replacement CT's assigned DNS
name; the saved JSON is a reference, not a transferable Tailscale identity.
Never use `down -v` on production.

## Exact operator next action

Open Actual over private HTTPS, set its server password, and create the one
shared household budget. Configure categories/accounts/schedules and SimpleFIN
in Actual as a separate human step. Before importing real bank data, confirm a
fresh successful off-CT backup. Supply Actual server password and Sync ID only
in the CT's protected env, then recreate web as documented in
[Actual integration](actual-integration.md). No bank import was performed here.
