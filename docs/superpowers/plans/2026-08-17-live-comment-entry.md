# 抓取评论词直播入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在养号模块后新增一个独立的“抓取评论词”入口页，让用户用同一组关键词和人数下限选择多台设备，按人工路径进入抖音搜索结果中的第一个直播间，并实时看到每台设备的阶段与结果。

**Architecture:** 新功能使用 `live_comment_entry` feature key 和独立手机任务工厂，不调用 `target_live_interaction` 或 `video_warmup` 的业务执行器。现有移动命令的 `RUNNING` 回执扩展为可重复更新，手机把当前阶段和有限长度的阶段历史写入命令结果，前端沿用现有轮询读取，因此刷新页面仍可恢复进度，不增加新的数据库表。

**Tech Stack:** TypeScript、Zod、Drizzle/Hono、React、Ant Design、AutoJS JavaScript、Bun tests。

---

### Task 1: 定义独立入口契约并锁定校验行为

**Files:**
- Modify: `account-data-platform/packages/types/src/domain/account-warmup.ts`
- Test: `account-data-platform/packages/types/src/domain/account-warmup.test.ts`
- Modify: `account-data-platform/packages/types/src/api/admin.ts`
- Test: `account-data-platform/apps/api/src/routes/account-warmup-command.test.ts`

- [ ] **Step 1: Write the failing schema tests**

```ts
test("accepts a live comment entry payload with a nonnegative viewer floor", () => {
  const parsed = accountWarmupRunPayloadSchema.parse({
    featureKey: "live_comment_entry",
    batchId: crypto.randomUUID(),
    config: { targetKeyword: "药材种植", minViewerCount: 300 }
  });
  expect(parsed.config.minViewerCount).toBe(300);
});

test("defaults the live comment entry viewer floor to 300 and rejects negatives", () => {
  expect(accountWarmupRunPayloadSchema.parse({
    featureKey: "live_comment_entry",
    batchId: crypto.randomUUID(),
    config: { targetKeyword: "测试" }
  }).config.minViewerCount).toBe(300);
  expect(() => accountWarmupRunPayloadSchema.parse({
    featureKey: "live_comment_entry",
    batchId: crypto.randomUUID(),
    config: { targetKeyword: "测试", minViewerCount: -1 }
  })).toThrow();
});
```

- [ ] **Step 2: Run the focused type test and verify it fails**

Run: `bun test packages/types/src/domain/account-warmup.test.ts`

Expected: FAIL because `live_comment_entry` is not yet a supported feature key.

- [ ] **Step 3: Add the discriminated-union branch and admin command validation**

Add a strict config with `targetKeyword: z.string().trim().min(1).max(100)` and `minViewerCount: z.coerce.number().int().min(0).default(300)`, add `live_comment_entry` to `accountWarmupFeatureKeySchema`, and add its payload branch to `accountWarmupRunPayloadSchema`. Keep `commandType` as `ACCOUNT_WARMUP_RUN` so existing command persistence and device authentication remain unchanged; the feature key selects the new executor branch.

- [ ] **Step 4: Run the focused tests and the API command test**

Run: `bun test packages/types/src/domain/account-warmup.test.ts apps/api/src/routes/account-warmup-command.test.ts`

Expected: PASS, including a `201` command whose payload preserves `featureKey`, normalized keyword, and `minViewerCount`.

- [ ] **Step 5: Commit the contract change**

```bash
git add account-data-platform/packages/types/src/domain/account-warmup.ts account-data-platform/packages/types/src/domain/account-warmup.test.ts account-data-platform/packages/types/src/api/admin.ts account-data-platform/apps/api/src/routes/account-warmup-command.test.ts
git commit -m "feat: define live comment entry command contract"
```

### Task 2: Make command progress durable and add the independent AutoJS entry task

**Files:**
- Modify: `account-data-platform/apps/api/src/repositories/task-assignment.repository.ts`
- Test: `account-data-platform/apps/api/src/services/command-progress.test.ts`
- Create: `mobile-agent/autojs/features/account-warmup/live-comment-entry.js`
- Test: `mobile-agent/autojs/tests/live-comment-entry.test.js`
- Modify: `mobile-agent/autojs/features/account-warmup/registry.js`
- Test: `mobile-agent/autojs/tests/account-warmup-registry.test.js`

- [ ] **Step 1: Write the failing repeated-progress test**

The service test should create/claim one `ACCOUNT_WARMUP_RUN`, acknowledge `RUNNING` once with `{stage:"OPENING_DOUYIN"}`, acknowledge `RUNNING` again with `{stage:"OPENING_SEARCH"}`, then assert the stored command is still `RUNNING` and contains the second result.

- [ ] **Step 2: Run it and verify the expected conflict**

Run: `bun test apps/api/src/services/command-progress.test.ts`

Expected: FAIL with `COMMAND_ACK_CONFLICT` on the second `RUNNING` acknowledgement.

- [ ] **Step 3: Permit repeated RUNNING updates without changing terminal semantics**

In `acknowledgeTaskAssignmentCommandAtomic`, accept `command.status === "RUNNING"` for a `RUNNING` input and update `resultJson`, `_ackHash`, and `updatedAt`; terminal statuses must continue to reject conflicting acknowledgements. Do not alter assignment state transitions for `DONE` or `FAILED`.

- [ ] **Step 4: Add the independent task test before implementation**

```js
test("enters the first live result and retries an empty result once", () => {
  const stages = [];
  const runtime = makeRuntime({ firstResult: false, retryResult: true });
  const task = createLiveCommentEntryTask({ runtime, reportStage: (event) => stages.push(event.stage) });
  const result = task.run({ targetKeyword: "药材种植", minViewerCount: 300 }, { shouldStop: () => false });
  assert.equal(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.deepEqual(stages, ["OPENING_DOUYIN", "OPENING_SEARCH", "INPUT_KEYWORD", "OPENING_LIVE_TAB", "OPENING_FIRST_RESULT", "RETRYING_SEARCH", "ENTERED"]);
});
```

- [ ] **Step 5: Implement the task with dependency injection**

`live-comment-entry.js` must expose `createLiveCommentEntryTask`. Its runtime interface is `{ openDouyin, openSearch(keyword, control), openLiveTab, openFirstLive, waitRandom, restartSearch, isLiveRoom }`. It reports each stage through `reportStage`, stops immediately when `control.shouldStop()` is true, retries only the missing-first-result path once, returns `LIVE_COMMENT_ENTRY_ENTERED` only after `isLiveRoom()` confirms the room, and returns `LIVE_COMMENT_ENTRY_FAILED` with `failedStage` and a readable `message` otherwise. The default runtime adapts `context.douyin` and the already-loaded fast search module; it must not instantiate or call the old target-live interaction runner.

- [ ] **Step 6: Register and test the new factory**

Load `features/account-warmup/live-comment-entry.js` in the registry, add a `live_comment_entry` factory, and extend the registry test to assert `registry.create("live_comment_entry").run` exists. Run: `node --test mobile-agent/autojs/tests/live-comment-entry.test.js mobile-agent/autojs/tests/account-warmup-registry.test.js`.

- [ ] **Step 7: Commit the task and progress behavior**

```bash
git add account-data-platform/apps/api/src/repositories/task-assignment.repository.ts account-data-platform/apps/api/src/services/command-progress.test.ts mobile-agent/autojs/features/account-warmup/live-comment-entry.js mobile-agent/autojs/tests/live-comment-entry.test.js mobile-agent/autojs/features/account-warmup/registry.js mobile-agent/autojs/tests/account-warmup-registry.test.js
git commit -m "feat: add live comment entry task and durable progress"
```

### Task 3: Wire stage reporting and scoped stop handling into the command bridge

**Files:**
- Modify: `mobile-agent/autojs/app/account-warmup-command-bridge.js`
- Test: `mobile-agent/autojs/tests/live-comment-entry-command-bridge.test.js`
- Modify: `account-data-platform/apps/api/src/repositories/command.repository.ts`
- Test: `account-data-platform/apps/api/src/repositories/command-claim.test.ts`

- [ ] **Step 1: Write failing bridge tests**

Assert that a live-entry command starts exactly one worker, sends ordered `RUNNING` progress acknowledgements containing `stageHistory`, sends `DONE` with `status: "LIVE_COMMENT_ENTRY_ENTERED"`, and a stop command produces `LIVE_COMMENT_ENTRY_STOPPED` without invoking the old publish cleanup. Also assert a pending stop command can be claimed while its matching run is `RUNNING`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test mobile-agent/autojs/tests/live-comment-entry-command-bridge.test.js` and `bun test apps/api/src/repositories/command-claim.test.ts`.

Expected: FAIL because the bridge has no live-entry branch and the claim query excludes stop commands behind an active run.

- [ ] **Step 3: Add bounded stage reporting**

In the bridge, keep `runState.stageHistory` capped at 20 entries. Pass `reportStage(stage, details)` to the new task; each report calls `uploader.ackCommand(command.id, "RUNNING", { featureKey, batchId, stage, stageHistory, ...details })` while the run is active. Extend terminal success detection for `LIVE_COMMENT_ENTRY_ENTERED`. For `live_comment_entry` stop requests, interrupt the worker and acknowledge both stop and target commands with `LIVE_COMMENT_ENTRY_STOPPED`; only legacy warmup features call `cleanupImmediatelyAfterStop`.

- [ ] **Step 4: Allow stop commands to bypass the active-run exclusion narrowly**

In `claimPendingCommandByDeviceId`, keep the single active worker rule for normal commands but allow `ACCOUNT_WARMUP_STOP` candidates through when the active command is `ACCOUNT_WARMUP_RUN`. Preserve ordering and expiration checks; do not allow a second run command.

- [ ] **Step 5: Run bridge, claim, and existing warmup tests**

Run: `node --test mobile-agent/autojs/tests/account-warmup-command-bridge.test.js mobile-agent/autojs/tests/live-comment-entry-command-bridge.test.js` and `bun test apps/api/src/repositories/command-claim.test.ts apps/api/src/routes/account-warmup-command.test.ts`.

Expected: all focused tests pass and existing target-live/video stop tests remain unchanged.

- [ ] **Step 6: Commit the wiring**

```bash
git add mobile-agent/autojs/app/account-warmup-command-bridge.js mobile-agent/autojs/tests/live-comment-entry-command-bridge.test.js account-data-platform/apps/api/src/repositories/command.repository.ts account-data-platform/apps/api/src/repositories/command-claim.test.ts
git commit -m "feat: report live comment entry progress"
```

### Task 4: Add frontend batch helpers, API client, and the independent page

**Files:**
- Create: `account-data-platform/apps/web/src/lib/live-comment-entry-form.ts`
- Test: `account-data-platform/apps/web/tests/live-comment-entry-form.test.js`
- Create: `account-data-platform/apps/web/src/lib/api-client-live-comment-entry.ts`
- Create: `account-data-platform/apps/web/src/routes/LiveCommentEntryPage.tsx`
- Modify: `account-data-platform/apps/web/src/routes/AccountWarmupModulePage.tsx`
- Test: `account-data-platform/apps/web/tests/live-comment-entry-page.test.js`

- [ ] **Step 1: Write failing helper and page-source tests**

Cover keyword trimming, default `minViewerCount = 300`, `0` meaning unrestricted, rejection of negative/non-integer values, one command per unique selected device, and extraction of `stageHistory` from `resultJson`. Assert the module mounts `LiveCommentEntryPage` after `VideoWarmupPage` and the page contains keyword, viewer-floor, multi-device, start, stop, batch summary, per-device stage, last-updated time, and error/result controls.

- [ ] **Step 2: Run the focused web tests and verify failure**

Run: `node --test apps/web/tests/live-comment-entry-form.test.js apps/web/tests/live-comment-entry-page.test.js`.

Expected: FAIL because the helper/page files do not exist.

- [ ] **Step 3: Implement the pure helpers and API client**

`buildLiveCommentEntryCommands` returns `ACCOUNT_WARMUP_RUN` payloads with `featureKey: "live_comment_entry"`, the shared trimmed keyword, and normalized nonnegative integer floor. `resolveLiveCommentEntryState` maps command status/result stage to Chinese labels and terminal flags. The API client calls `/admin/mobile-commands` with the existing `startAccountWarmupDevice` shape and scoped `ACCOUNT_WARMUP_STOP` payload.

- [ ] **Step 4: Implement the page and mount it**

Use Ant Design controls and existing `getDevices`/`getAccountWarmupCommands` polling. Persist the active batch id and last keyword in local storage. Filter rows by the new feature key and batch id, show the latest stage plus a compact timeline from `stageHistory`, show elapsed/updated time and result/error, and keep one device failure isolated from the rest. Disable selection while a batch is active. Add the tab label `抓取评论词` immediately after `视频养号`; do not modify the old pages.

- [ ] **Step 5: Run web typecheck and focused tests**

Run: `node --test apps/web/tests/live-comment-entry-form.test.js apps/web/tests/live-comment-entry-page.test.js` and `bun --filter @app/web build`.

Expected: focused tests pass and the web build succeeds.

- [ ] **Step 6: Commit the frontend**

```bash
git add account-data-platform/apps/web/src/lib/live-comment-entry-form.ts account-data-platform/apps/web/tests/live-comment-entry-form.test.js account-data-platform/apps/web/src/lib/api-client-live-comment-entry.ts account-data-platform/apps/web/src/routes/LiveCommentEntryPage.tsx account-data-platform/apps/web/src/routes/AccountWarmupModulePage.tsx account-data-platform/apps/web/tests/live-comment-entry-page.test.js
git commit -m "feat: add live comment entry page"
```

### Task 5: End-to-end focused verification and handoff

**Files:**
- Modify: `account-data-platform/apps/web/tests/account-warmup-page.test.js` only if the tab assertion needs an explicit non-regression check
- Modify: `docs/superpowers/specs/2026-08-17-live-comment-entry-design.md` only for implementation notes discovered during verification

- [ ] **Step 1: Run all new tests together**

Run: `bun test packages/types/src/domain/account-warmup.test.ts apps/api/src/routes/account-warmup-command.test.ts apps/api/src/services/command-progress.test.ts apps/api/src/repositories/command-claim.test.ts` and `node --test mobile-agent/autojs/tests/live-comment-entry.test.js mobile-agent/autojs/tests/live-comment-entry-command-bridge.test.js mobile-agent/autojs/tests/account-warmup-registry.test.js apps/web/tests/live-comment-entry-form.test.js apps/web/tests/live-comment-entry-page.test.js`.

Expected: all new tests pass.

- [ ] **Step 2: Run non-regression checks**

Run: `bun --filter @app/web build`, `bun --filter @app/api test`, and the existing AutoJS account warmup tests. Record pre-existing unrelated failures separately; do not change old assertions to hide them.

- [ ] **Step 3: Inspect the final diff for scope**

Run: `git diff --stat HEAD~5..HEAD` and `git diff --check HEAD~5..HEAD`. Confirm no comment extraction, database vocabulary writes, viewer-count inspection, package-name changes, or modifications to old warmup task implementations were introduced.

- [ ] **Step 4: Push the feature branch**

```bash
git push origin feat/publish-video-module
```

