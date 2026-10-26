# Agent entry point

This repository is the OpenGym Agent extension, based on upstream openGym 1.4.1.
Read `docs/AGENT_DEPLOYMENT.md` before deployment and `docs/OPERATIONS.md` for
validation and known failures. `CLAUDE.md` describes architecture; where it describes
old upstream media services or release infrastructure, this entry point takes priority.

- New deployments use `docker-compose.agent.yml` and a local ignored `agent.env`.
  Never substitute upstream prebuilt API/Web images for this extension.
- Use the operator's own host, domain, accounts, Apple Team and signing identities.
  `example.com`, `com.example` and empty team settings are placeholders.
- Keep credentials, user/health data, backup bundles and operator journals out of Git,
  image build contexts and logs. Do not access a former maintainer's instance.
- Preserve existing uncommitted changes. Put modifications on a separate branch.
- Training decisions, progression and history reconstruction belong in pure frontend
  helpers with meaningful tests beside them. Preserve per-account isolation and sync.
- Install from lockfiles using Node 22. Run affected tests and a production build;
  report the known baseline failures in `docs/OPERATIONS.md` honestly.
- Use synthetic test accounts. Do not modify real workout or health data for smoke tests.
- No production data deletion, automatic backup restore, force-push or tag replacement.
  Record code revisions and image IDs before upgrades; keep rollback artifacts private.
- Keep AGPL and third-party notices. Licensed exercise media is deliberately excluded
  from this Git snapshot; the deployment Web image retains upstream media in-place.
- Do not enable upstream mirroring, image publication or Pages workflows as part of an
  ordinary install. Actions are disabled on the shared repository.
