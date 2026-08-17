# Base Connectivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new outer base heartbeat and the shared device-access status shown by the API, management page, and phone UI.

**Architecture:** The API owns the status calculation using server receive time and a per-device offline threshold. A new Android foreground-service module lives only under `mobile-agent/android-base`; the APK packaging script copies this module into the temporary AutoJs6 build tree. The existing Agent heartbeat and the inert remote-wake action remain untouched.

**Tech Stack:** Bun, TypeScript, Hono, Drizzle/PostgreSQL, React, Ant Design, Kotlin/Android foreground services, PowerShell.

---

### Task 1: Shared API contract and status calculation

**Files:**
- Modify: `account-data-platform/packages/types/src/api/admin.ts`
- Modify: `account-data-platform/apps/api/src/services/admin.service.ts`
- Test: `account-data-platform/apps/api/src/services/base-connectivity-status.test.ts`

- [ ] Write tests for ONLINE, RECONNECTING, and OFFLINE using 6 seconds and a configurable 15-150 second threshold.
- [ ] Run the test and verify it fails because the new status contract does not exist.
- [ ] Add the minimal pure status calculator and device response fields.
- [ ] Run the test and verify it passes.

### Task 2: Persistence and heartbeat response

**Files:**
- Modify: `account-data-platform/packages/db/src/schema.ts`
- Create: `account-data-platform/packages/db/src/migrations/0036_base_connectivity_threshold.sql`
- Modify: `account-data-platform/apps/api/src/repositories/device.repository.ts`
- Modify: `account-data-platform/apps/api/src/services/mobile.service.ts`
- Modify: `account-data-platform/apps/api/src/routes/mobile.ts`
- Modify: `account-data-platform/apps/api/src/routes/admin.ts`
- Test: `account-data-platform/apps/api/src/routes/base-connectivity.routes.test.ts`

- [ ] Write route and repository contract tests for server receive time, threshold response, and per-device threshold update.
- [ ] Run the tests and verify the expected red failures.
- [ ] Persist `baseOfflineThresholdSeconds` with default 15 and validate 15-150 seconds.
- [ ] Return the threshold from successful base heartbeat responses.
- [ ] Add the dedicated admin threshold update endpoint without creating a mobile command.
- [ ] Run the tests and verify they pass.

### Task 3: Management device-access UI

**Files:**
- Modify: `account-data-platform/apps/web/src/routes/DeviceList.tsx`
- Modify: `account-data-platform/apps/web/src/features/remote-wake/RemoteWakePage.tsx`
- Create: `account-data-platform/apps/web/src/features/remote-wake/BaseConnectivityStatus.tsx`
- Modify: `account-data-platform/apps/web/src/lib/api-client.ts`
- Test: `account-data-platform/apps/web/tests/base-connectivity-status.test.ts`

- [ ] Write tests for the three labels, reconnect progress, threshold marks, outside-click close, and the dedicated settings request.
- [ ] Run the test and verify it fails because the component and client method do not exist.
- [ ] Implement the status component and per-device popover slider.
- [ ] Keep Agent, screen, and inert action columns unchanged.
- [ ] Run tests and Web typecheck.

### Task 4: New main-project Android outer base

**Files:**
- Create: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseConnectivityProtocol.kt`
- Create: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseConnectivityClient.kt`
- Create: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseConnectivityService.kt`
- Create: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseConnectivityBootReceiver.kt`
- Create: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseConnectivityStateStore.kt`
- Create: `mobile-agent/android-base/src/main/AndroidManifest.xml`
- Create: `mobile-agent/android-base/src/test/java/com/agri/video/collector/base/BaseConnectivityContractTest.kt`

- [ ] Write contract tests for the 2-second loop, foreground notification, boot entry, identity reuse, threshold persistence, and three phone states.
- [ ] Run tests and verify the expected red failure before source creation.
- [ ] Implement the isolated foreground service without Agent or remote-wake dependencies.
- [ ] Run the contract tests and source checks.

### Task 5: Build synchronization and boundary verification

**Files:**
- Modify: `scripts/package-autojs-apk.ps1`
- Create: `scripts/tests/android-base-sync.test.ps1`

- [ ] Write a failing script test proving the package step sources the Android base only from `mobile-agent/android-base`.
- [ ] Add deterministic copy and manifest merge steps into the temporary AutoJs6 build tree.
- [ ] Verify the script never treats `D:\DevTools` as the source of truth.
- [ ] Run all focused tests, Web typecheck, API entry build, Android contract tests, and old remote-wake boundary scans.
