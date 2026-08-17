# Account Warmup Service Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount account warmup as a standalone main navigation module after video publishing and verify the existing service chain without creating a real device command.

**Architecture:** Keep quick-paste publishing under video publishing. Add a standalone `/account-warmup` page whose first and only current child function is target-live interaction using `ACCOUNT_WARMUP_RUN`; future watch, like and comment capabilities extend inside that child function. Reuse the existing Vite and Bun watch processes on ports 3024 and 3012.

**Tech Stack:** React, Ant Design, Bun, Hono, Zod, Vite, PostgreSQL, Redis.

---

### Task 1: Restore the warmup main module

**Files:**
- Modify: `account-data-platform/apps/web/tests/account-warmup-page.test.js`
- Modify: `account-data-platform/apps/web/tests/publish-video-module.test.js`
- Create: `account-data-platform/apps/web/src/routes/AccountWarmupModulePage.tsx`
- Modify: `account-data-platform/apps/web/src/routes/App.tsx`
- Modify: `account-data-platform/apps/web/src/routes/PublishVideoModulePage.tsx`

- [ ] Change the Web tests to require a standalone `养号` main menu after `视频发布` and remove it from video publishing tabs.
- [ ] Run the focused navigation tests and confirm RED because the standalone module is absent.
- [ ] Add `/account-warmup`, `AccountWarmupModulePage`, and its single `目标直播间互动养号` child tab.
- [ ] Re-run the two Web tests and confirm GREEN.

### Task 2: Verify running services

**Files:**
- No configuration file changes.

- [ ] Confirm ports 3012, 3024, 5432 and 6379 are listening.
- [ ] Request `GET http://127.0.0.1:3012/health` and require HTTP 200.
- [ ] Request `GET http://127.0.0.1:3024/publish-video` and require HTTP 200.
- [ ] Login to the development API, send an invalid `ACCOUNT_WARMUP_RUN` payload with an unsupported feature key, and require HTTP 400 without creating a command.

### Task 3: Regression and records

**Files:**
- Modify: `docs/项目开发/远程脚本模块/进度台账.md`
- Modify: `docs/项目开发/项目记录.md`

- [ ] Run `bun test`, `bun run typecheck`, `bun run lint`, and `bun run build` from `account-data-platform`.
- [ ] Run the focused AutoJS bridge, registry and target-live tests.
- [ ] Update both required records with the restored UI entry and service verification results.
- [ ] Run `git diff --check` and confirm no source file in this change exceeds 400 lines.
