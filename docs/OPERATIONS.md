# Deployment and repository maintenance

This branch selectively tracks upstream openGym 1.4.4 with the optional OAuth/MCP plugin,
nutrition and daily health, iPhone HealthKit sync and a standalone watchOS client.
The source and tests are versioned together. Start with [the documentation index](README.md).
The current integration boundary is documented in [the 1.4.4 release](UPSTREAM_1_4_4_INTEGRATION.md).

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

## Public source 1.4.4 verification — 2026-11-06

The sanitized public snapshot was independently installed from its lockfiles using the local npm cache. Frontend: 5,485 tests passed; API: 692 passed; Plugin: 85 passed; read-only MCP: 96 passed. The production frontend build, generated API documentation consistency, plain-Node API/MCP imports, iOS project wiring, Watch/shared Swift protocols and five backup-script tests passed.

Personal domains, paths and Apple signing configuration were replaced with examples; operator credentials, runtime data, media downloads, signed shortcuts, packages and private development history are excluded. Gitleaks found only the two previously reviewed dependency-checksum and synthetic push-test constants; no additional suppression was introduced. Repository Actions remain disabled.

This source review did not build or start the portable Docker stack, configure another deployment, or exercise real health permissions/OAuth/device sync. The standalone Watch source version is 0.5.0 (7). The existing Android APK Release remains a separately signed distribution with different deployment/signing settings.
