# Getting started on Proxmox

This is the initial infrastructure skeleton, based on sections 3, 12–14 of
[the build plan](doc_bd8b06650f63_family_finance_dashboard_proxmox_build_plan.pdf).
Actual remains the ledger. The single Next.js web/API service currently serves
only a hello page and `/api/health`; its database and Actual environment wiring
is reserved for later phases. There is no authentication, schema, synchronization,
or household logic yet. The health endpoint checks process liveness only.

## Prepare the LXC

Create a Debian 13 **unprivileged** LXC named `family-finance`, enable nesting,
and allocate 2 vCPU, 2 GB RAM, 1 GB swap and 24–32 GB disk. Assign a stable LAN
address. If builds run out of memory, temporarily use 3–4 GB RAM or 2 GB swap.

Inside the LXC, install Docker Engine and the Compose plugin using Docker's
[Debian installation instructions](https://docs.docker.com/engine/install/debian/).
Verify `docker version` and `docker compose version`. Copy this repository into
`/opt/family-finance-dashboard` (there is no GitHub remote yet). Commands below
run from that directory, with Docker permissions or `sudo`.

## Configure and start

```sh
cp infrastructure/.env.example infrastructure/.env
chmod 600 infrastructure/.env
# Edit infrastructure/.env: replace POSTGRES_PASSWORD with a random secret.
# Select a tested ACTUAL_VERSION release tag for reproducible deployments.
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml config --quiet
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml up -d --build
docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml ps
curl --fail http://127.0.0.1:3000/api/health
```

The build installs locked npm dependencies; the LXC needs registry access.
Actual persists `/data` in `family-finance_actual-data`; PostgreSQL 17 persists
its data in `family-finance_postgres-data`. PostgreSQL has no published port and
uses a private internal network. Changing the password variable after database
initialization does not change the database role password.

## HTTPS and access

Both application ports bind only to LXC loopback: app `3000`, Actual `5006`.
Run an existing reverse proxy on the LXC host network, with internal DNS names
such as `finance.home.example` and `actual.home.example` pointing to the LXC.
Configure HTTPS with certificates trusted by your devices; proxy those names to
`127.0.0.1:3000` and `127.0.0.1:5006` respectively. Preserve Actual's response
headers and support WebSocket forwarding. If your proxy runs elsewhere, provide
a private authenticated tunnel to these loopback upstreams before use.
Use HTTPS browser URLs; plain HTTP loopback above is only an operational probe.
See [Actual's Docker guide](https://actualbudget.org/docs/install/docker/).

Keep access private to the household LAN/VPN (Tailscale or WireGuard); do not
publish these applications to the Internet. The custom app has no login yet,
so keep it behind proxy access controls. Initialize Actual through HTTPS; bank
credentials and SimpleFIN setup belong in Actual, never in Git. Household budget
configuration and imports are operator follow-up, outside this skeleton.

## Development and checks

Use Node.js 22 and npm from the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

`npm test` currently runs the TypeScript check; there is no behavioral test suite
at this stage. Development listens on loopback. The Docker image runs the
standalone production server as a non-root user. Next.js serves the Node API
routes in the same process; no separate API microservice is needed.

## Persistence and backups

`docker compose --env-file infrastructure/.env -f infrastructure/compose.yaml down`
stops services without deleting data. **Do not use `down -v`** unless deliberately
removing both data volumes. Verify data survives a restart on the target LXC.

Before storing real finances, configure daily encrypted backups of Actual data,
a PostgreSQL `pg_dump`, Compose/configuration (including the protected `.env`),
and daily Proxmox/PBS backups. Stop Actual while copying its volume for a
consistent backup; use `pg_dump` rather than copying a live PostgreSQL directory.
Retain weekly snapshots and monthly backups, and periodically restore both
services into an isolated LXC. Backup automation is not included in this skeleton.

Validation on the authoring host is recorded in the local commit/session outcome;
Docker startup, persistence and HTTPS must be checked on the target LXC.

Initial skeleton verification: dependency installation, `npm run typecheck`,
`npm test`, `npm run build`, Compose `config --quiet` with the example environment,
and standalone HTTP checks for the hello page, CSS and health endpoint passed.
The authoring host had Node 26; the container targets Node 22. Docker Engine was
unavailable, so image build and live service integration remain unverified.
