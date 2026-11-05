# Upstream v1.4.2: agent workflow and selective integration

Reviewed on 2026-10-26 against upstream tag `v1.4.2` (`e9a303877d02e4237b183f96a9a6603990e8fafb`).

## Product direction

This fork serves an agent-first workflow: record actual sets and loads in Notes during training,
use Apple's Workout app to collect the workout and heart rate, then send the notes to ChatGPT
for import through the Plugin after training. Exercises and sets need not be prepared in openGym
before a session. Do not merge upstream's live workout Watch app as part of this update.

Our standalone Watch client remains focused on server binding and health-data upload.

## What the upstream Watch app does

Source: [`frontend/ios/App/Watch`](https://github.com/DuarteSantos8/openGym/tree/v1.4.2/frontend/ios/App/Watch),
[`WatchBridgePlugin.swift`](https://github.com/DuarteSantos8/openGym/blob/v1.4.2/frontend/ios/App/App/WatchBridgePlugin.swift),
[`watch-sync.js`](https://github.com/DuarteSantos8/openGym/blob/v1.4.2/frontend/src/lib/watch-sync.js).

- It is an iPhone companion (`WKRunsIndependentlyOfCompanionApp = false`). Apple device pairing
  and WatchConnectivity supply the transport. It does not implement our QR-to-server account
  binding or issue an independent server upload credential to the Watch.
- The iPhone sends a snapshot using application context, with a live message when reachable.
  This distinguishes replaceable current state from events that must be delivered individually.
- Watch operations carry a unique event ID and workout/exercise/set identity. Events use
  `transferUserInfo`; the iPhone persists received events, and JavaScript applies and acknowledges
  them. The frontend waits for its saved profile to load and for required handlers to exist.
- The watch's `WorkoutManager` starts a HealthKit workout. Per-set heart-rate averages/maxima
  use sample timestamps between app-controlled set boundaries and a Done tap. This is not
  automatic recognition of lifting sets, and is not a reason to replace Apple's Workout app
  in this fork's workflow.

The state/event split, readiness checks, durable delivery and idempotent acknowledgement are
useful review patterns. Our Watch client already has a persistent pending batch, strict ACK
validation and independent device credentials; compare those mechanisms when improving it.
The upstream companion transport does not simplify our independent server-account binding.
No Watch training code was imported by this selective update.

## Account deletion integration

Selectively adopt upstream's deletion flow without upgrading the entire application:

- Settings → Account offers backup export, typed account-name confirmation and identity proof.
- Browser deletion requires a passkey or the current password. A paired passwordless phone uses
  its pairing after local device authentication, following upstream behavior.
- Newly minted tokens distinguish browser cookies (`c`) from paired-device tokens (`b`), so
  replaying a new browser cookie as a Bearer cannot bypass deletion proof or renew it indefinitely.
  Legacy untyped sessions remain compatible, as upstream does.
- The last administrator cannot leave while other profiles remain. The sheet learns this before
  asking for proof, and the server checks again after asynchronous verification.
- Both administrator deletion and self-deletion call the same cleanup function. In this fork it
  also clears heart-rate and daily-health files, upload credentials, temporary Shortcut credentials,
  Watch credentials/binding sessions, Plugin OAuth grants/tokens and associated pending OAuth
  requests, cached account state and pending rest timers. Other accounts are preserved.
- Stop native HealthKit uploads before self-deletion. Failure to stop prevents the request.
  On success, clear the local session and that account's kept changes.

The flow deletes server-owned data and this device's openGym session. It does not delete source
health samples collected by Apple's Workout app, personal Notes, exported backups, or copies
already on other offline devices. No production deletion or deployment is part of this change.

## Validation

- Related API/auth/health/Watch suites: 66 tests passed, including both deletion entry points
  with two-account health, device-key and Plugin OAuth isolation.
- Deletion UI/store, device authentication, settings search and audit tests: 78 passed.
  Existing mobile remote/adoption suites also passed in a bounded two-worker run (28 tests).
- Plugin suite passed (56 tests before the additional cleanup case); the OAuth reconnect and
  cleanup suite then passed all 7 tests, including removal of pending authorization codes.
- Frontend production build, unsigned iOS device build, Android Java compilation, iOS plugin
  wiring check and generated API documentation check passed. Device authentication and deletion
  on real phones have not been exercised.
- Broader tests are not all green: the API run had 11 failures in existing Coach/payload tests;
  those same 11 failures reproduce on the unchanged HEAD snapshot. The frontend run had 8
  failing assertions across existing locale, URL, placeholder, health-summary and date tests;
  all 8 reproduce on HEAD. Two additional parallel import timeouts passed on the bounded rerun.
  The pt-BR inherited-translation fingerprint remains identical to HEAD; its existing expected
  fingerprint mismatch was not accepted or rewritten by this update.


## Deployment — 2026-10-26

Deployed at 18:21:55 Asia/Taipei as `1.4.1+account-delete-20261026`. API/Web healthy;
63 related API tests and 57 Plugin tests passed in isolated Linux containers. Encrypted
backup uploaded; all 22 account-data file checksums stayed unchanged. Public assets match
the release and MCP/OAuth/catalogue/auth-guard smoke checks passed without private-data writes.

Existing Android/iPhone/standalone Watch installs remain compatible. Website deletion is
available after refresh. Only using the new deletion UI inside a packaged Android/iPhone app
requires a later package update; the Watch app needs no update or rebinding for this rollout.
Plugin tools/scopes are unchanged and do not require ChatGPT reconnection.
