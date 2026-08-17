# Unified Device Recovery Design

## Goal

Unify automatic boot recovery and administrator-triggered wake-up under one observable recovery session. The management console must show what the phone is doing before the normal heartbeat channel becomes ready.

## Product Rules

- A missing heartbeat is reported as `DEVICE_UNREACHABLE`, not as a confirmed power-off state.
- Automatic boot recovery creates an `AUTO_BOOT` session without an administrator click.
- Manual recovery creates a `MANUAL_WAKE` session and uses the same stages and progress UI.
- A phone that has no network records recovery stages locally and uploads their original timestamps when connectivity returns.
- Phase timeouts are: network readiness 120 seconds, Agent launch 30 seconds, registration and heartbeat readiness 60 seconds.
- A task sent to an online locked phone may wake the screen and attempt keyguard dismissal. A secure keyguard that cannot be dismissed requires manual unlock.
- Successful recovery remains visible as a compact result with completion time and duration.
- Xiaomi Push is outside the first release. A fully stopped Agent without a polling process cannot be remotely started in this release.

## Session Model

Each recovery session belongs to one device and has one source:

- `AUTO_BOOT`: created from boot-stage reports.
- `MANUAL_WAKE`: created from a management-console action and optionally linked to a mobile command.

Stages are monotonic:

1. `WAITING_DEVICE`
2. `SYSTEM_BOOTED`
3. `NETWORK_CONNECTED`
4. `AGENT_LAUNCHED`
5. `DEVICE_REGISTERED`
6. `HEARTBEAT_RESTORED`
7. `COMMAND_CHANNEL_READY`

The session stores its current summary. Immutable stage events store the diagnostic timeline and the original device occurrence time. An event idempotency key prevents duplicate uploads after reconnect.

## Results And Errors

Session results are `SUCCEEDED`, `FAILED`, or `TIMED_OUT`. Errors identify the failed boundary rather than presenting one generic timeout:

- `DEVICE_UNREACHABLE`
- `NETWORK_READY_TIMEOUT`
- `AGENT_LAUNCH_TIMEOUT`
- `DEVICE_REGISTRATION_TIMEOUT`
- `HEARTBEAT_RESTORE_TIMEOUT`
- `COMMAND_CHANNEL_TIMEOUT`
- `SCREEN_WAKE_FAILED`
- `KEYGUARD_DISMISS_FAILED`
- `APP_LAUNCH_FAILED`
- `SECURE_KEYGUARD_REQUIRES_USER`

## First Delivery Scope

The first delivery covers milestones 1-3 only:

1. Preserve the current `AGENT_POLL` timeout as a diagnostic baseline.
2. Add shared source, stage, result, error and payload contracts.
3. Add recovery session and stage event persistence schemas and migration.

No API wiring, mobile reporting, status projection, UI changes, APK build or device installation is included in these milestones.

## Verification

- Contract tests prove valid automatic and manual sessions and reject invalid stage/error values.
- Schema tests prove table names, foreign keys, nullable manual command linkage and unique event idempotency.
- Migration tests prove both tables and required indexes are declared.
- Package type checks prove the public exports compile.
