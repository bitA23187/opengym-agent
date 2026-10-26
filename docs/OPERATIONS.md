# Deployment and repository maintenance

This branch extends upstream openGym 1.4.1 with the optional OAuth/MCP plugin,
nutrition and daily health, iPhone HealthKit sync and a standalone watchOS client.
The source and tests are versioned together. Start with [the documentation index](README.md).

## Validate a checkout

Use Node 22 (the CI/runtime baseline) and install each package from its lockfile:

```sh
npm ci
npm ci --prefix frontend
npm ci --prefix api --omit=optional
npm ci --prefix api/plugin
npm ci --prefix mcp
npm test --prefix frontend
npm test --prefix api
npm test --prefix api/plugin
npm test --prefix mcp
npm run build --prefix frontend
node scripts/build-api-docs.mjs --check
node api/scripts/check-core-loadable.mjs
npm run check:node-loadable --prefix mcp
```

Native checks require Xcode on macOS:

```sh
node frontend/scripts/check-ios-project.mjs
bash frontend/watchos/scripts/check-watchos.sh --test
```

See [iOS sync](HEALTHKIT_NATIVE_SYNC.md), [Android development](ANDROID_DEVELOPMENT.md)
and [watchOS development](WATCHOS_DEVELOPMENT.md) for platform builds and device checks.

## Server deployment

For portable extension installs, follow [AGENT_DEPLOYMENT.md](AGENT_DEPLOYMENT.md)
and use `docker-compose.agent.yml`. The Dockerfiles under `deploy/` install locked
dependencies inside build stages; no host Node or preinstalled plugin modules are required.
The older overlay path below is retained for existing installations.

`docker-compose.yml` is the portable upstream stack. `docker-compose.server.yml`
is an instance-specific example: its image content IDs, paths and external ingress
network must be replaced for another installation. `server.env.example` describes
server settings; copy it into an ignored environment file and provide your own values.

The private plugin overlay is built from the repository root after installing its
locked runtime dependencies:

```sh
npm ci --omit=dev --prefix api/plugin
docker build -f api/plugin/Dockerfile -t opengym-api:local .
npm run build --prefix frontend
docker build -f web/plugin.Dockerfile -t opengym-web:local .
```

Before activation, run the relevant tests and create an encrypted consistent backup
using `scripts/backup-server.sh` with your deployment's paths, recipient and upload
configuration. Keep the previous image IDs and Compose file. After activation,
verify service health, authentication, account isolation and static assets. Roll back
code using the saved images/Compose; restoring personal data is a separate decision.
See [plugin upgrades](PLUGIN_UPGRADES.md) for upstream compatibility checks.

## Local-only files

The root `OPERATIONS.md` and `DEPLOYMENT_REVIEW.md` are local operator journals,
including historical releases and rollback evidence. They stay on the operator's
machine and are excluded from Git and Docker build contexts. References to a dated
release in older feature guides refer to that local journal.

`artifacts/` holds local APK/IPA builds, screenshots and acceptance logs; `plugin.zip`
is the original private installation package. These remain local and ignored.
Runtime data, environment files, dependencies and native build outputs are also ignored.

Retired heart-rate probe services, one-time activation scripts, early UI mockups,
superseded plugin feasibility/publication reports and the stale integration patch
have been removed. The maintained feature guides, tests, native clients, shortcut
generators and license notices remain with their implementations.

## Checkout verification — 2026-10-26

Repository cleanup was checked with local Node 24.22.1 (CI uses Node 22).
The existing checkout had failures before cleanup; this snapshot does not claim a
fully green regression suite:

- Frontend, `TZ=UTC`: 5,150 passed, 5 failed. Remaining failures are locale key
  parity, the pt-BR inherited wording fingerprint, empty-value dash consistency,
  an nginx proxy-count assertion and an outdated nutrition statistics assertion.
  The host timezone additionally fails three date/demo/export assertions.
- API: 633 passed, 11 failed, with the same counts under UTC. Failures are in
  `coach-limits`, `jobs`, `payload-bounds`, `payload`, `prompt-split` and `routes`.
- Optional plugin: 56 passed. MCP under UTC: 95 passed.
- Frontend production build, generated API documentation consistency, plain Node
  API/MCP import checks, iOS project wiring and watchOS/shared Swift protocol tests passed.
- The plugin Docker overlay now includes Watch pairing, credentials and vendored
  QR code required by `server.js`. A full image build was attempted but blocked
  at base-image resolution by Docker's DNS connection refusal. Image execution
  and native device behavior were not revalidated during repository cleanup.

## Agent sharing snapshot — 2026-10-26

New portable configuration: `docker-compose.agent.yml`, `agent.env.example` and
`deploy/agent-*.Dockerfile`. HTTP bootstrap deliberately disables the MCP plugin;
the plugin enforces an HTTPS ORIGIN and is enabled after TLS is configured.

Checks performed in an isolated clean source worktree on Node 24.22.1:

- Frontend production build passed; plugin suite: 56 passed.
- API core imports, iOS source wiring and Watch Xcode plist syntax passed.
- Isolated API start, health, configured HTTPS OAuth issuer, 27 tool descriptors,
  public exercise search and denial of an unauthenticated profile read passed.
  The probe used a fresh temporary data directory and loopback HTTP transport;
  this does not claim TLS, actual OAuth login, native devices or production acceptance.
- Consistent encrypted backup harness: 5 passed, with age, flock and GNU coreutils.
- Compose configuration validation passed. Docker image build was attempted but
  blocked while resolving Docker Hub base images: the local Colima daemon's DNS
  resolver returned connection refused. Container execution remains unverified.
- Earlier full frontend/API regression failures listed above remain the baseline;
  they were not represented as fixed by the sharing work.

Dependency audit of the existing lockfiles also reports production advisories:
API `undici` (high); plugin `body-parser` (high), `fast-uri` (moderate), `zod` (high).
This sharing task does not silently upgrade dependencies or claim these resolved.
Audit currently proposes a major Zod migration; evaluate compatibility and rerun
affected tests before an internet-facing production rollout. The initial tag is
published as a source-preview release, with these limitations visible.
