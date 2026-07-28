# Task Switch Current Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a newly received backend `START` command for `live` or `live_comment` cannot be executed as stale `video`.

**Architecture:** Store the normalized backend task type in a small run request latch before setting the agent to running. `runOneTask()` consumes that latch first, then falls back to live-comment priority, then persisted scheduler state, then video.

**Tech Stack:** Auto.js CommonJS JavaScript, Node `assert` for pure unit tests, existing PowerShell APK packaging.

---

### Task 1: Add Run Request Resolver

**Files:**
- Create: `mobile-agent/autojs/app/run-request-resolver.js`
- Test: `mobile-agent/autojs/tests/run-request-resolver.test.js`

- [ ] Write a failing test proving a pending `live_comment` request beats stale active `video`.
- [ ] Write a failing test proving a pending `live` request beats stale active `video`.
- [ ] Implement `createRunRequestResolver(context)` with `setPendingTaskType`, `consumePendingTaskType`, and `resolveRequestedTaskType`.
- [ ] Run `node mobile-agent/autojs/tests/run-request-resolver.test.js` and verify it passes.

### Task 2: Wire Command Handling Before Running State

**Files:**
- Modify: `mobile-agent/autojs/app/control-loop.js`
- Modify: `mobile-agent/autojs/main.module.js`
- Modify: `mobile-agent/autojs/app/collector-app.js`

- [ ] In `main.module.js`, create the resolver and attach it to context.
- [ ] In `control-loop.js`, for every backend `START`/`RESUME` path, normalize the incoming `payload.taskType`, write it to the resolver, then set `floatyControl.state.running=true`.
- [ ] In `collector-app.js`, make `resolveRequestedTaskType()` call resolver first and consume the pending request.
- [ ] Add runtime log fields `requestedTaskType` and `pendingTaskTypeSource` to `task_start`.

### Task 3: Verify And Package

**Files:**
- Existing test and source files only.

- [ ] Run `node --check` on changed Auto.js files.
- [ ] Run both Auto.js Node tests.
- [ ] Run compatibility grep for `=>`, `const`, `let`, and `.map(` in production Auto.js files.
- [ ] Run backend/frontend baseline tests that are practical in this repo.
- [ ] Package APK with `scripts/package-autojs-apk.ps1`.
- [ ] Verify APK signature and version.
