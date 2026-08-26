# 抓取评论词物理隔离与原子化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在独立 `features/new-comment/` 目录中等价重建抓取评论词功能，并以唯一 featureKey、独立桥接器和原子动作层阻止新任务进入旧评论或视频发布流程。

**Architecture:** 新实现复用公共无障碍、OCR、日志和上传能力，但不引用 `features/account-warmup/**`。`main.module.js` 先安装新桥接器，再安装旧桥接器；新桥接器只消费 `isolated_live_comment_entry` 及其精确 STOP，其他命令保持原链路。业务流程由同步原子动作、集中布局配置、等价状态机和独立清理组成。

**Tech Stack:** AutoJS/CommonJS JavaScript、TypeScript/Zod、React、Bun/Node tests、PowerShell APK packaging、ADB。

---

### Task 1: 锁定独立任务契约

**Files:**
- Modify: `account-data-platform/packages/types/src/domain/account-warmup.ts`
- Modify: `account-data-platform/packages/types/src/domain/account-warmup.test.ts`
- Modify: `account-data-platform/apps/web/src/lib/live-comment-entry-form.ts`
- Modify: `account-data-platform/apps/web/src/lib/live-comment-entry-batch.ts`
- Modify: `account-data-platform/apps/web/src/lib/api-client-live-comment-entry.ts`
- Modify: `account-data-platform/apps/web/src/routes/LiveCommentEntryPage.tsx`
- Modify: `account-data-platform/apps/web/tests/live-comment-entry-form.test.js`
- Modify: `account-data-platform/apps/web/tests/live-comment-entry-page.test.js`
- Modify: `account-data-platform/apps/api/src/routes/account-warmup-command.test.ts`

- [ ] **Step 1: Write failing contract and frontend tests**

Add assertions that a valid new command has this exact payload and that `live_comment_entry` remains accepted as legacy:

```ts
const payload = accountWarmupRunPayloadSchema.parse({
  featureKey: "isolated_live_comment_entry",
  batchId: crypto.randomUUID(),
  config: { targetKeyword: "药材种植", minViewerCount: 300 }
});
expect(payload.featureKey).toBe("isolated_live_comment_entry");
expect(accountWarmupFeatureKeySchema.parse("live_comment_entry")).toBe("live_comment_entry");
```

Frontend tests must require all newly built commands and query filters to use `isolated_live_comment_entry`.

- [ ] **Step 2: Run tests and confirm RED**

Run from `account-data-platform/`:

```powershell
bun test packages/types/src/domain/account-warmup.test.ts apps/api/src/routes/account-warmup-command.test.ts
node --test apps/web/tests/live-comment-entry-form.test.js apps/web/tests/live-comment-entry-page.test.js
```

Expected: failures because the new feature key is not accepted or emitted.

- [ ] **Step 3: Add the strict feature branch and update only the new UI path**

Add a second strict payload branch using the existing config schema:

```ts
const isolatedLiveCommentEntryRunPayloadSchema = z.object({
  featureKey: z.literal("isolated_live_comment_entry"),
  batchId: batchIdSchema,
  config: accountWarmupLiveCommentEntryConfigSchema
}).strict();
```

Add the literal to `accountWarmupFeatureKeySchema` and the branch to `accountWarmupRunPayloadSchema`. Change command construction, query filtering and page row filtering to the new value; leave result status mapping unchanged.

- [ ] **Step 4: Run tests and confirm GREEN**

Run the commands from Step 2. Expected: all focused tests pass.

### Task 2: 建立原子动作和集中布局配置

**Files:**
- Create: `mobile-agent/autojs/features/new-comment/contract.js`
- Create: `mobile-agent/autojs/features/new-comment/douyin-layout.js`
- Create: `mobile-agent/autojs/features/new-comment/gesture-actions.js`
- Create: `mobile-agent/autojs/features/new-comment/screen-actions.js`
- Create: `mobile-agent/autojs/tests/new-comment-actions.test.js`

- [ ] **Step 1: Write failing atom tests**

Cover bounded coordinate jitter, double click order, all four swipe directions, selector timeout, OCR image recycle and stop-before-action. The public result shape must be:

```js
assert.deepStrictEqual(result, { success: false, reason: "STOP_REQUESTED", message: "task stopped" });
```

- [ ] **Step 2: Run and confirm RED**

```powershell
node --test mobile-agent/autojs/tests/new-comment-actions.test.js
```

Expected: module-not-found failures.

- [ ] **Step 3: Implement minimal synchronous atoms**

`gesture-actions.js` exports `createGestureActions(deps, layout)` with `click`, `doubleClick`, `swipe` and `waitRandom`. `screen-actions.js` exports `createScreenActions(deps, layout)` with `waitForNode`, `readText`, `captureRegions` and `detectPlatformVerification`. All AutoJS globals are injected through `deps`; workflow files must not call them directly.

- [ ] **Step 4: Run atom tests and syntax checks**

```powershell
node --check mobile-agent/autojs/features/new-comment/contract.js
node --check mobile-agent/autojs/features/new-comment/douyin-layout.js
node --check mobile-agent/autojs/features/new-comment/gesture-actions.js
node --check mobile-agent/autojs/features/new-comment/screen-actions.js
node --test mobile-agent/autojs/tests/new-comment-actions.test.js
```

Expected: all commands succeed.

### Task 3: 等价迁移评论解析和分页抓取

**Files:**
- Create: `mobile-agent/autojs/features/new-comment/comment-capture.js`
- Create: `mobile-agent/autojs/features/new-comment/comment-runner.js`
- Create: `mobile-agent/autojs/tests/new-comment-capture.test.js`
- Create: `mobile-agent/autojs/tests/new-comment-runner.test.js`

- [ ] **Step 1: Write failing equivalence tests**

Use fixed OCR fixtures to compare legacy and isolated results:

```js
assert.deepStrictEqual(
  isolatedCapture.buildCandidates(pages, scope),
  legacyCapture.buildCandidates(pages, scope)
);
```

Runner tests cover three OCR attempts, five swipes, two consecutive no-new pages, platform verification before/after OCR and STOP partial candidates.

- [ ] **Step 2: Run and confirm RED**

```powershell
node --test mobile-agent/autojs/tests/new-comment-capture.test.js mobile-agent/autojs/tests/new-comment-runner.test.js
```

- [ ] **Step 3: Implement isolated pure logic**

Copy behavior, constants and result semantics into the new directory without any production `require` of legacy modules. `comment-runner.js` receives `runtime`, `commentCapture`, `reportStage` and `shouldStop` through arguments.

- [ ] **Step 4: Run focused and legacy tests**

```powershell
node --test mobile-agent/autojs/tests/new-comment-capture.test.js mobile-agent/autojs/tests/new-comment-runner.test.js mobile-agent/autojs/tests/live-comment-capture.test.js mobile-agent/autojs/tests/live-comment-entry.test.js
```

Expected: isolated equivalence tests and legacy regressions all pass.

### Task 4: 等价迁移工作流、运行时和清理

**Files:**
- Create: `mobile-agent/autojs/features/new-comment/runtime.js`
- Create: `mobile-agent/autojs/features/new-comment/workflow.js`
- Create: `mobile-agent/autojs/features/new-comment/cleanup.js`
- Create: `mobile-agent/autojs/features/new-comment/index.js`
- Create: `mobile-agent/autojs/tests/new-comment-workflow.test.js`
- Create: `mobile-agent/autojs/tests/new-comment-isolation.test.js`

- [ ] **Step 1: Write failing workflow and dependency tests**

The workflow test compares old/new stage order and terminal results for success, one search retry, live-ended skip, viewer threshold exhaustion, verification and STOP. The dependency test scans every production file under `features/new-comment/` and rejects:

```js
assert.doesNotMatch(source, /features[\\/]account-warmup|\.\.\/account-warmup/);
assert.doesNotMatch(source, /features[\\/]publish-video/);
```

- [ ] **Step 2: Run and confirm RED**

```powershell
node --test mobile-agent/autojs/tests/new-comment-workflow.test.js mobile-agent/autojs/tests/new-comment-isolation.test.js
```

- [ ] **Step 3: Implement the isolated state machine**

`runtime.js` composes the new atoms with `context.douyin`, `context.screenRecognizer`, `context.riskDetector`, `context.viewerCountParser` and the public accessibility driver. `workflow.js` preserves the existing search/room/viewer/capture state machine. `cleanup.js` owns only the isolated task's exit actions and is idempotent. `index.js` exports `createIsolatedLiveCommentEntryTask(context, options)`.

- [ ] **Step 4: Run workflow, isolation and legacy tests**

```powershell
node --test mobile-agent/autojs/tests/new-comment-workflow.test.js mobile-agent/autojs/tests/new-comment-isolation.test.js mobile-agent/autojs/tests/live-comment-entry-live-room-confirmation.test.js mobile-agent/autojs/tests/live-comment-entry-gesture-readiness.test.js
```

### Task 5: 建立独立桥接器和互斥门禁

**Files:**
- Create: `mobile-agent/autojs/features/new-comment/command-bridge.js`
- Create: `mobile-agent/autojs/tests/new-comment-command-bridge.test.js`
- Modify: `mobile-agent/autojs/main.module.js`
- Create: `mobile-agent/autojs/tests/new-comment-entry-wiring.test.js`

- [ ] **Step 1: Write failing route and lifecycle tests**

Cover exact run routing, malformed `isolated_*` rejection with `ROUTE_MISMATCH`, legacy passthrough, matching STOP, mismatched STOP passthrough, stage-history cap, partial result preservation, duplicate command idempotency and old/new mutual exclusion.

- [ ] **Step 2: Run and confirm RED**

```powershell
node --test mobile-agent/autojs/tests/new-comment-command-bridge.test.js mobile-agent/autojs/tests/new-comment-entry-wiring.test.js
```

- [ ] **Step 3: Implement and wire the bridge**

In `main.module.js`, load and install in this order:

```js
var createNewCommentCommandBridge = localRequire("features/new-comment/command-bridge.js").createNewCommentCommandBridge;
context.newCommentCommandBridge = createNewCommentCommandBridge(context);
context.newCommentCommandBridge.install();
context.accountWarmupCommandBridge = createAccountWarmupCommandBridge(context);
context.accountWarmupCommandBridge.install();
```

The new wrapper is therefore inside the old wrapper's `originalPoll` chain and sees isolated commands first. It checks `context.accountWarmupCommandBridge.getActive()` at execution time and consumes old warmup run commands with `ACCOUNT_WARMUP_BUSY` while the isolated task is active.

- [ ] **Step 4: Run focused and old bridge tests**

```powershell
node --test mobile-agent/autojs/tests/new-comment-command-bridge.test.js mobile-agent/autojs/tests/new-comment-entry-wiring.test.js mobile-agent/autojs/tests/account-warmup-command-bridge.test.js mobile-agent/autojs/tests/account-warmup-video-stop.test.js mobile-agent/autojs/tests/live-comment-entry-command-bridge.test.js
```

Expected: new routing passes and all old bridge tests remain unchanged.

### Task 6: 完整本地验证与文档记录

**Files:**
- Modify: `docs/项目开发/项目记录.md`
- Modify: `docs/项目开发/卡点与问题记录.md`
- Modify: `docs/项目开发/代码审查风险记录.md`

- [ ] **Step 1: Enforce source limits and dependency isolation**

Run a PowerShell check that fails if any changed JS/TS/TSX file exceeds 400 physical lines, or any `features/new-comment` production file imports an old business directory.

- [ ] **Step 2: Run all focused tests**

```powershell
node --test mobile-agent/autojs/tests/new-comment-*.test.js
bun test packages/types/src/domain/account-warmup.test.ts apps/api/src/routes/account-warmup-command.test.ts
node --test apps/web/tests/live-comment-entry-form.test.js apps/web/tests/live-comment-entry-page.test.js
```

- [ ] **Step 3: Run regression suites**

```powershell
node --test mobile-agent/autojs/tests/account-warmup-*.test.js mobile-agent/autojs/tests/live-comment-entry*.test.js mobile-agent/autojs/tests/biz-script-bundle.test.js
bun run lint
bun run typecheck
bun test
bun run build
```

Run Bun commands from `account-data-platform/`. Record unrelated pre-existing failures without changing old tests to hide them.

- [ ] **Step 4: Update project records**

Record the physical isolation boundary, route identifier, exact tests, remaining APK/truth-device risk and any discovered legacy issue. Do not modify the user-supplied root TXT file.

### Task 7: 构建、安装和真机验收

**Files:**
- Modify: `mobile-agent/autojs/project.json`
- Create: `dist/apk/燎原星火-<new-version>-inrt.apk` and checksum sidecar as local build artifacts
- Create: `docs/verification/<date>-new-comment-isolation/` evidence files where applicable

- [ ] **Step 1: Bump the APK version and verify the fixed signing key**

Increase `versionName` and `versionCode` once. Before packaging, verify the selected JKS certificate SHA-256 equals `eb2913f5c1e52c2b1b94f458b3f2a1818fd52ff15468815563221c62d3209216`; abort on mismatch or missing JKS.

- [ ] **Step 2: Build and verify the APK**

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-autojs-apk.ps1
```

Verify `apksigner`, `zipalign`, package name, version, arm64-v8a and SHA-256 sidecar.

- [ ] **Step 3: Preflight the device and preserve data**

Confirm ADB device `41cc82eb` is authorized, no task is active, package signature matches, and current accessibility-service list is saved. Do not run the repository installer because its default uninstall clears data.

- [ ] **Step 4: Upgrade install without uninstall**

Use `adb install -r -g <apk>`. Abort instead of uninstalling if Android reports a signature or downgrade error.

- [ ] **Step 5: Restore and verify system capabilities**

Check the exact accessibility component `com.agri.video.collector/org.autojs.autojs.core.accessibility.AccessibilityServiceUsher`. If it is not bound, merge it into the existing secure setting and re-check `dumpsys accessibility`; never overwrite other enabled services. If MIUI or MediaProjection requires touch confirmation, stop and hand off to the user.

- [ ] **Step 6: Run one controlled real task**

Open the local management UI in the in-app browser, select “抓取评论词”, enter `药材种植`, choose one device and submit. In parallel monitor ADB window/focus, Agent logs, command ACKs and backend status. Confirm the new featureKey and new-module stages appear before accepting success.

- [ ] **Step 7: Run safety scenarios**

Verify malformed isolated route rejection, old command passthrough, same-device busy rejection, matching and mismatched STOP, immediate worker interruption, partial comments and platform-verification safe stop. Do not deliberately trigger or bypass a platform challenge.

- [ ] **Step 8: Record evidence and final status**

Save command/log excerpts and screenshots without secrets. Report which device actions were automated and which, if any, require the user's manual confirmation the next day.

