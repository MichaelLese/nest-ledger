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
This verifies the requested web restart. The isolated artifact restore drill below
passed on 2026-09-11; a full CT reboot/application recovery has not been tested.

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
backups remain separate infrastructure follow-up. The isolated artifact restore
drill below verifies the initial backup format.
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

## Isolated artifact restore drill — 2026-09-11

Ran from agent-hub against the read-only snapshot
`/home/agent/backups/nest-ledger/20260911T031505Z`, using SSH alias `nest-ledger`
for Docker on CT 116. Agent-hub has no Docker. This was an artifact restore,
not a replacement-CT deployment or application/budget validation. No production
container was modified, stopped, removed or replaced; the only production DB
access was the read-only Compose/psql SELECT below. No production volume was
mounted and no production Compose lifecycle command was run.

Results:

| Table | Restored snapshot | Live at drill time |
| --- | ---: | ---: |
| household_members | 3 | 3 |
| transaction_metadata | 0 | 1 |
| bills | 0 | 0 |
| split_rules | 1 | 1 |
| household_settings | 1 | 1 |

The transaction metadata discrepancy is consistent with a post-snapshot change,
but row counts alone do not prove its cause or row-level equivalence. No live
row contents were read. `pg_restore --list` reported 31 TOC entries, custom
format 1.16-0, source PostgreSQL/pg_dump 17.11, created 03:15:06 UTC.
`pg_restore --exit-on-error --single-transaction` exited 0 using the native
`nest_ledger` role/database, with no migration or ownership override needed.
The drill's `postgres:17` resolved to PostgreSQL 17.11 on Debian 13, image digest
`sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675`;
production's dump came from Debian 12. The image was pulled and remains cached;
no image pruning was performed.

All four entries in `SHA256SUMS` passed before and after the drill. Input sizes
were `postgres.dump` 12,996 bytes, `actual-data.tar.gz` 340,600 bytes,
`config.tar.gz` 28,812 bytes and `tailscale-serve.json` 407 bytes. SHA256SUMS
contains archive hashes, **not extracted-file sizes**: extracted sizes and bytes
were separately compared with the checksum-verified tar members. The structure
was `server-files/account.sqlite` (69,632 bytes), two files under `user-files/`
(a SQLite file of 2,134,016 bytes and a blob of 27,293 bytes), and `.migrate`
(861 bytes). All four matched. File contents and configuration secrets were
not printed or committed.

### Commands executed

The following records the successful commands, grouped by operation. Run local
commands in Bash on agent-hub; remote heredocs execute on CT 116. The production
replacement procedure above is **not** the procedure for a drill on live CT 116.

```sh
set -euo pipefail
snapshot=/home/agent/backups/nest-ledger/20260911T031505Z
# Read-only resource inventory; repeat after teardown.
ssh -o BatchMode=yes nest-ledger 'docker ps -a --format "{{.Names}}"; docker volume ls --format "{{.Name}}"; docker network ls --format "{{.Name}}"'
(cd "$snapshot" && sha256sum -c SHA256SUMS &&
 stat -c '%n %s bytes' postgres.dump actual-data.tar.gz config.tar.gz tailscale-serve.json &&
 tar -tzvf actual-data.tar.gz)

ssh -o BatchMode=yes nest-ledger 'bash -se' <<'REMOTE'
set -euo pipefail
if docker container inspect nest-ledger-drill-pg >/dev/null 2>&1; then
  echo 'Drill name already exists; aborting without changes' >&2; exit 1
fi
docker run -d --name nest-ledger-drill-pg --network none \
  --memory 512m --cpus 1 \
  --tmpfs /var/lib/postgresql/data:rw,size=384m \
  -e POSTGRES_DB=nest_ledger -e POSTGRES_USER=nest_ledger \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17
ready=false
for attempt in $(seq 1 60); do
  if docker exec nest-ledger-drill-pg pg_isready -U nest_ledger -d nest_ledger >/dev/null; then ready=true; break; fi
  sleep 1
done
"$ready"
docker inspect nest-ledger-drill-pg --format 'network={{.HostConfig.NetworkMode}} mounts={{json .Mounts}} compose_project={{index .Config.Labels "com.docker.compose.project"}}'
REMOTE

ssh -o BatchMode=yes nest-ledger 'docker exec -i nest-ledger-drill-pg pg_restore --list' < "$snapshot/postgres.dump"
ssh -o BatchMode=yes nest-ledger 'docker exec -i nest-ledger-drill-pg pg_restore -U nest_ledger -d nest_ledger --exit-on-error --single-transaction' < "$snapshot/postgres.dump"
sql="SELECT 'household_members' AS table_name, count(*) FROM household_members UNION ALL SELECT 'transaction_metadata', count(*) FROM transaction_metadata UNION ALL SELECT 'bills', count(*) FROM bills UNION ALL SELECT 'split_rules', count(*) FROM split_rules UNION ALL SELECT 'household_settings', count(*) FROM household_settings;"
printf '%s\n' "$sql" | ssh -o BatchMode=yes nest-ledger 'docker exec -i nest-ledger-drill-pg psql -X -U nest_ledger -d nest_ledger -v ON_ERROR_STOP=1'
printf '%s\n' "$sql" | ssh -o BatchMode=yes nest-ledger 'cd /opt/nest-ledger && docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml exec -T postgres sh -c '\''PGOPTIONS="-c default_transaction_read_only=on" psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'\'''
ssh -o BatchMode=yes nest-ledger 'docker exec nest-ledger-drill-pg postgres --version'
```

Inspection returned `network=none mounts=[] compose_project=`. Explicit tmpfs at
PGDATA prevents an anonymous Docker volume; no network or volume was created.
Trust authentication is only for this disposable, network-disabled container
with no published ports. Do not use that setting for production.

Actual extraction ran locally on agent-hub, under a fresh mode-700 directory
`/tmp/nest-ledger__drill-q7nmetd6`, with Python's safe data extraction filter:

```sh
python3 - <<'PYTHON'
import pathlib, tarfile, tempfile, shutil
source=pathlib.Path('/home/agent/backups/nest-ledger/20260911T031505Z/actual-data.tar.gz')
root=pathlib.Path(tempfile.mkdtemp(prefix='nest-ledger__drill-', dir='/tmp'))
try:
    with tarfile.open(source, 'r:gz') as archive:
        members=archive.getmembers()
        assert all((m.isdir() or m.isfile()) and not pathlib.PurePosixPath(m.name).is_absolute() and '..' not in pathlib.PurePosixPath(m.name).parts for m in members)
        archive.extractall(root, filter='data')
        for m in members:
            if m.isfile():
                p=root/m.name
                assert p.stat().st_size == m.size
                assert p.read_bytes() == archive.extractfile(m).read()
        assert (root/'server-files').is_dir() and (root/'user-files').is_dir()
        for folder in ['server-files','user-files']:
            sizes=sorted(p.stat().st_size for p in (root/folder).iterdir() if p.is_file())
            print(f'{folder}/: file sizes {sizes} bytes')
        print(f'.migrate: {(root/".migrate").stat().st_size} bytes')
        print('All 4 extracted files match archive sizes and bytes; archive checksum previously passed.')
finally:
    shutil.rmtree(root)
    print(f'Removed {root}; absent={not root.exists()}')
PYTHON

ssh -o BatchMode=yes nest-ledger 'docker rm -f nest-ledger-drill-pg && docker ps -a --format "{{.Names}}" && docker volume ls --format "{{.Name}}" && docker network ls --format "{{.Name}}"'
(cd "$snapshot" && sha256sum -c SHA256SUMS)
```

Teardown exited 0; the extraction directory reported `absent=True`. Post-drill
container, volume and network name inventories matched preflight, with no drill
objects left. `nest-ledger-drill-net` was never created, so no network removal
was needed. Input files were never written.

### Limitations and fragile steps

- The earlier replacement-CT instructions use production Compose names and
  volume mounts; they must remain confined to a fresh replacement CT. The
  commands above provide the verified alternative for live-host isolation.
- Agent-hub cannot run Docker locally; SSH stdin streaming into containerized
  PostgreSQL tools worked without copying the dump onto CT storage.
- The 384 MB tmpfs and 512 MB memory limit fit this small snapshot, not an
  arbitrary future dataset. Reassess capacity for larger backups. `postgres:17`
  is a moving tag; the resolved version/digest above records this run.
- Cleanup was explicit across SSH calls, not a persistent remote exit trap. If
  interrupted after creation, inspect the exact drill name and remove only the
  task-owned `nest-ledger-drill-pg`; also remove the recorded local extraction
  directory if Python's `finally` could not run. Never prune shared Docker state.
- Python must support `tarfile`'s `filter='data'`; byte comparison reads each file
  into memory. The test validates archive extraction, not SQLite integrity,
  Actual login, budget totals, synchronization or restored application startup.
- Config checksum passed but config was not extracted. Tailscale cutover, full
  CT recovery, web health after restore, and a real-data financial reconciliation
  remain untested. No merge, deployment, bank sync or production restart was
  part of this drill.

## Exact operator next action

Open Actual over private HTTPS, set its server password, and create the one
shared household budget. Configure categories/accounts/schedules and SimpleFIN
in Actual as a separate human step. Before importing real bank data, confirm a
fresh successful off-CT backup. Supply Actual server password and Sync ID only
in the CT's protected env, then recreate web as documented in
[Actual integration](actual-integration.md). No bank import was performed here.
