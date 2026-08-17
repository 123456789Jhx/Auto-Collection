# Unified Device Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one observable recovery lifecycle shared by automatic phone boot and management-console wake-up.

**Architecture:** Shared Zod contracts define the lifecycle. PostgreSQL stores one mutable session summary plus immutable idempotent stage events. Later API, mobile and UI milestones consume these boundaries without changing their meaning.

**Tech Stack:** Bun, TypeScript, Zod, Drizzle ORM, PostgreSQL

---

### Task 1: Diagnostic Baseline

**Files:**
- Create: `docs/verification/2026-08-12-agent-poll-timeout-baseline.md`

- [x] Record the observed device, command channel, last heartbeat, visible stage and timeout outcome without credentials.
- [x] Define evidence required to distinguish command delivery, screen wake, app launch and heartbeat recovery failures.

### Task 2: Shared Recovery Contract

**Files:**
- Create: `account-data-platform/packages/types/src/api/device-recovery.ts`
- Create: `account-data-platform/packages/types/src/api/device-recovery.test.ts`
- Modify: `account-data-platform/packages/types/src/index.ts`

- [x] Write tests for `AUTO_BOOT` and `MANUAL_WAKE`, monotonic stages, terminal results, diagnostic errors and stage reports.
- [x] Run `bun test packages/types/src/api/device-recovery.test.ts` and confirm the missing module fails.
- [x] Implement the minimal Zod schemas and inferred types.
- [x] Export the contract from the package root.
- [x] Re-run the targeted test and package type check.

### Task 3: Recovery Session Persistence

**Files:**
- Create: `account-data-platform/packages/db/src/device-recovery-schema.ts`
- Create: `account-data-platform/packages/db/src/device-recovery-schema.test.ts`
- Create: `account-data-platform/packages/db/src/device-recovery-migration.test.ts`
- Create: `account-data-platform/packages/db/src/migrations/0033_device_recovery_sessions.sql`
- Modify: `account-data-platform/packages/db/src/schema.ts`
- Modify: `account-data-platform/packages/db/src/migrations/meta/_journal.json`

- [x] Write schema tests for session summary fields, optional command linkage and idempotent stage events.
- [x] Write a migration test for both tables, foreign keys and indexes.
- [x] Run both tests and confirm they fail because the schema and migration do not exist.
- [x] Implement the focused Drizzle schema.
- [x] Export it from the package schema root.
- [x] Add the SQL migration and journal entry.
- [x] Re-run targeted tests and the database package type check.

### Task 4: Recovery API

- [x] Write failing tests for session reuse, idempotency, delayed reports and latest timeline queries.
- [x] Implement authenticated mobile reporting and authenticated admin queries.
- [x] Preserve monotonic progress and mark `COMMAND_CHANNEL_READY` successful.

### Task 5: Local Mobile Recovery Journal

- [x] Write failing Node tests for persistent, idempotent stage logging.
- [x] Persist boot-scoped events with original occurrence times.
- [x] Keep pending events until the server acknowledges them.

### Task 6: Idempotent Upload And Retry

- [x] Test ordered upload, partial failure retention, authentication wait and retry throttling.
- [x] Upload pending events in order and acknowledge only server-confirmed events.
- [x] Wire watchdog, Agent launch, registration, heartbeat and command-poll success boundaries.
- [x] Prevent concurrent flushes and request storms.

### Task 7: Unify Manual Wake Execution

- [x] Create a `MANUAL_WAKE` recovery session when an `OPEN_AGENT_APP` command is dispatched.
- [x] Link the recovery session to the existing mobile command and complete both from the same terminal ACK.
- [x] Extend the phone journal and sync path with command-scoped manual recovery events.
- [x] Preserve successful command-poll metadata through the remote-wake interceptor.

### Task 8: Timeout And Status Projection

- [x] Add deterministic stage timeout rules for device reachability, network, Agent launch, registration, heartbeat and command readiness.
- [x] Persist `TIMED_OUT` with the first failed boundary and expose deadline, elapsed time and user-action projection.
- [x] Keep completed sessions immutable and make repeated timeout evaluation idempotent.

### Task 9: Unified Management Progress

- [x] Add a typed Web client for latest device recovery state and timeline.
- [x] Render automatic boot and manual wake through one progress component with source, stage, duration and terminal result.
- [x] Show an offline device as unreachable with a manual power-on instruction, without claiming confirmed power-off.
- [x] Poll active recovery at one second and stable device state at five seconds.

### Task 10: Database And Service Deployment

- [x] Verify the active local database, API, Web and public tunnel targets before deployment.
- [x] Apply migrations `0032` and `0033` in order and verify the migration journal, tables and indexes.
- [x] Verify local API health, public API health and the public management page.

### Task 11: APK Release And Installation

- [x] Raise the APK version to `1.0.80` / `116` without changing the package name or signing configuration.
- [x] Verify the Android build toolchain, local registration-secret source, packaging script and mobile recovery regressions.
- [x] Have the user build the signed APK with the provided PowerShell command.
- [x] Verify the resulting APK version, package name, signature and checksum without exposing secrets.
- [x] Install the APK with `adb install -r -g` while preserving application data and verify the installed version.

### Task 12: Device Acceptance

- [ ] Have the user execute automatic-boot and manual-wake acceptance on the physical device.
- [ ] Record recovery stages, heartbeat restoration, command fetch and terminal ACK timing.

## Out Of Scope After Milestone 9

Lock-screen execution refinements beyond the existing remote-wake actions and Xiaomi push integration remain out of scope. Device acceptance is performed manually by the user in milestone 12.
