# Legacy Business Freeze Implementation Plan

> **For agentic workers:** Execute these steps in order with test-first verification. Keep all legacy implementation files and all publish/mobile-agent behavior intact.

**Goal:** Add a reversible `LEGACY_BUSINESS_FROZEN` switch that blocks legacy collection writes and removes their visible Web entry points without affecting video publishing, remote scripts, device lifecycle, binding, or mobile APIs.

**Architecture:** Parse the environment switch in API config. A focused `legacy-freeze.ts` service classifies only legacy state commands and task-assignment writes, returning the standard 409 error response when frozen. Admin routes call the guard before validation so frozen writes consistently return 409; unaffected route groups never call it. Web code removes legacy navigation and collection controls while retaining page implementations and maintenance controls.

**Tech Stack:** Bun, TypeScript, Hono, React, Ant Design, Bun test.

---

### Task 1: Lock the freeze contract with failing tests

**Files:**
- Modify: `account-data-platform/apps/api/src/config.test.ts`
- Create: `account-data-platform/apps/api/src/services/legacy-freeze.test.ts`
- Modify: `account-data-platform/apps/web/tests/live-targets-page.test.js`
- Modify: `account-data-platform/apps/web/tests/device-account-binding.test.js`

- [x] Assert the config defaults to false and parses true/false values.
- [x] Assert frozen legacy commands return 409 with `LEGACY_BUSINESS_FROZEN`.
- [x] Assert the disabled switch allows the same command and publish routes remain callable.
- [x] Assert the sidebar hides scheduler/config, dashboard has no scheduler command, and DevicesPage has no legacy state commands while binding and maintenance remain.
- [x] Run the focused tests and confirm they fail for the missing freeze implementation.

### Task 2: Implement API configuration and guard

**Files:**
- Modify: `account-data-platform/apps/api/src/config.ts`
- Create: `account-data-platform/apps/api/src/services/legacy-freeze.ts`
- Modify: `account-data-platform/apps/api/src/routes/admin.ts`

- [x] Add a reusable boolean parser and `legacyBusinessFrozen` config field.
- [x] Classify `START`, `PAUSE`, `RESUME`, and `STOP` as legacy mobile commands.
- [x] Treat both task-assignment creation endpoints as legacy writes.
- [x] Return `{ error: { code, message } }` with status 409 when frozen.
- [x] Wire the guard into the three admin POST handlers only.
- [x] Run API focused tests and confirm green.

### Task 3: Freeze Web entry points without deleting legacy pages

**Files:**
- Modify: `account-data-platform/apps/web/src/routes/App.tsx`
- Modify: `account-data-platform/apps/web/src/routes/DashboardPage.tsx`
- Modify: `account-data-platform/apps/web/src/routes/DevicesPage.tsx`

- [x] Remove scheduler/config menu items with a visible `LEGACY_FREEZE` comment while keeping page imports and render branches.
- [x] Remove dashboard scheduler buttons while keeping the dashboard and legacy scheduler implementation.
- [x] Remove START/PAUSE/STOP/RESUME controls from device rows and detail controls.
- [x] Narrow the remaining command mutation to non-legacy maintenance command types.
- [x] Keep account binding, device editing, refresh-config, version checks, updates, and restart controls.
- [x] Run Web focused tests and typecheck.

### Task 4: Document the reversible switch and node completion

**Files:**
- Create: `account-data-platform/apps/api/.env.example`
- Modify: `docs/项目开发/远程脚本模块/进度台账.md`
- Modify: `docs/项目开发/项目记录.md`

- [x] Add a commented `LEGACY_BUSINESS_FROZEN=true` example and state that missing/false restores legacy writes.
- [x] Add and complete the N1 ledger row with test and manual verification evidence.
- [x] Append the N1 project record without changing prior entries.

### Task 5: Verify and commit

- [x] Run focused tests, `bun test`, `bun run typecheck`, `bun run lint`, and `bun run build`.
- [x] Check modified source line counts and record the pre-existing oversized Devices/Dashboard files under the repository's existing exception.
- [x] Start an isolated API with the switch enabled; authenticate, verify legacy mobile command 409, and verify publish-task GET 200.
- [x] Start Web, verify sidebar/device controls and open Devices, Remote Scripts, and Publish Tasks pages.
- [x] Restart or test with the switch false and verify a valid legacy command is accepted; clean up any test data.
- [x] Review `git diff`, stage only N1 files, and create the requested Chinese commit.
