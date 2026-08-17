# Account Warmup Target Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first account-warmup workflow that fans one target-live search request out to selected devices and leaves each successful device inside a verified target live room.

**Architecture:** Reuse `mobile_commands` for dispatch and status, add a generic `ACCOUNT_WARMUP_RUN` contract, and install an isolated mobile command bridge from `main.module.js`. The bridge resolves allowlisted `featureKey` values through a hot-updated business-script registry and runs the selected sub-400-line feature in a background thread, so later warmup features do not require another APK bridge change.

**Tech Stack:** Bun, Hono, Zod, React, Ant Design, AutoX.js/CommonJS, Node test runner.

---

### Task 1: Shared command contracts

**Files:**
- Create: `account-data-platform/packages/types/src/domain/account-warmup.ts`
- Modify: `account-data-platform/packages/types/src/api/admin.ts`
- Modify: `account-data-platform/packages/types/src/index.ts`
- Test: `account-data-platform/packages/types/src/domain/account-warmup.test.ts`

- [ ] Write failing tests for trimmed target keywords, 1～30 deduplicated related terms, three rounds/four candidates, and stop payload UUIDs.
- [ ] Run `bun test packages/types/src/domain/account-warmup.test.ts` and verify RED.
- [ ] Implement the feature config, generic run and stop schemas, then add both command types to `createMobileCommandSchema`.
- [ ] Re-run the test and verify GREEN.

### Task 2: Frontend API and UI behavior

**Files:**
- Create: `account-data-platform/apps/web/src/lib/account-warmup-form.ts`
- Create: `account-data-platform/apps/web/src/lib/api-client-account-warmup.ts`
- Create: `account-data-platform/apps/web/src/routes/AccountWarmupPage.tsx`
- Modify: `account-data-platform/apps/web/src/routes/PublishVideoModulePage.tsx`
- Test: `account-data-platform/apps/web/tests/account-warmup-page.test.js`

- [ ] Write failing behavior tests for tag normalization, device fan-out, batch IDs, status mapping, stop payloads, and the “养号” tab.
- [ ] Run the focused Web test and verify RED.
- [ ] Implement the form helpers and typed API calls.
- [ ] Implement the compact Ant Design form, device multiselect, batch actions and device result table.
- [ ] Add the “养号” tab and re-run focused tests to GREEN.

### Task 3: Mobile target matching and navigation

**Files:**
- Create: `mobile-agent/autojs/features/account-warmup/target-live-entry.js`
- Test: `mobile-agent/autojs/tests/account-warmup-target-live.test.js`

- [ ] Write failing tests for primary/related-term OR matching, stable-region-only evidence, three-by-four retry limits, stop checks, live-tab selection and recovery callbacks.
- [ ] Run the Node test and verify RED.
- [ ] Implement the dependency-injected workflow using existing Douyin adapter methods.
- [ ] Re-run the focused Node test and verify GREEN.

### Task 4: Mobile command bridge and wiring

**Files:**
- Create: `mobile-agent/autojs/app/account-warmup-command-bridge.js`
- Create: `mobile-agent/autojs/features/account-warmup/registry.js`
- Modify: `mobile-agent/autojs/main.module.js`
- Test: `mobile-agent/autojs/tests/account-warmup-command-bridge.test.js`
- Test: `mobile-agent/autojs/tests/biz-script-bundle.test.js`

- [ ] Write failing tests proving allowlisted registry loading, path rejection, command interception, duplicate FETCHED suppression, background completion ACK, stop signaling and non-warmup passthrough.
- [ ] Run focused tests and verify RED.
- [ ] Implement the generic bridge and install it before `createControlLoop(context)`.
- [ ] Confirm the registry and feature script are present in the business-script bundle and run tests to GREEN.

### Task 5: Integration verification and records

**Files:**
- Modify: `docs/项目开发/项目记录.md`
- Modify: `docs/项目开发/远程脚本模块/进度台账.md`
- Modify when a defect is found: `docs/项目开发/卡点与问题记录.md`

- [ ] Run shared type, Web and AutoJS focused tests.
- [ ] Run `node --check` for all new/modified AutoJS files and confirm source files are at most 400 lines.
- [ ] Run `bun test`, `bun run typecheck`, `bun run lint`, and `git diff --check`.
- [ ] Update required records with implemented scope, commands, verification and the fact that true-device calibration remains pending.
- [ ] Verify `git diff --cached --name-only` is unchanged.
