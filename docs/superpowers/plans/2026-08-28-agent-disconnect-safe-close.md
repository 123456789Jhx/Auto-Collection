# Agent 断联安全收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在内部 Agent 被停止时，由外部 Agent 复用既有退出动作完成界面清理和服务端回执，收口旧任务，并让 Agent 重启后进入无任务状态。

**Architecture:** 在 `collector_devices` 中增加 Agent 实际生命周期、轮询开关和会话标识，保留 `desiredAgentState` 作为服务端意图。AutoJS launcher 发送停止事件；Android 外部 Agent 负责启动独立清理脚本并发送阶段回执；API 事务化终止旧命令；Web 依据实际状态显示弹窗并控制按钮。

**Tech Stack:** AutoJS/CommonJS JavaScript、Android Kotlin、Hono API、Drizzle/PostgreSQL、React/Ant Design、Bun tests、Node tests。

**Spec:** `docs/superpowers/specs/2026-08-28-agent-disconnect-safe-close-design.md`

## Global Constraints

- 保留 AutoJS + JavaScript 运行时，不引入 TypeScript、第三方依赖或新的编译规则到手机脚本。
- 不修改视频养号、直播互动、抓取评论词等业务流程脚本。
- 复用现有 `features/new-comment/cleanup.js` 与 `app/remote-wake-recents.js` 的安全退出动作。
- 内部 Agent 的强制停止动作保持不变；外部 Agent 只负责断联后的安全收口和回执。
- 底座网络心跳与 Agent 业务生命周期保持独立。
- 任务历史记录保留；清除的是运行态、设备占用和旧命令执行资格。
- 新建或修改的 `.js/.ts/.tsx` 文件不超过 400 行。

---

### Task 1: Add persisted Agent lifecycle contract

**Files:**
- Modify: `account-data-platform/packages/db/src/schema.ts` in `collectorDevices`
- Create: `account-data-platform/packages/db/src/migrations/0041_agent_lifecycle.sql`
- Modify: `account-data-platform/packages/types/src/api/mobile.ts`
- Test: `account-data-platform/apps/api/src/services/agent-lifecycle-contract.test.ts`

**Interfaces:**
- `collectorDevices.agentLifecycleState`: `varchar(24)`, default `RUNNING`.
- `collectorDevices.pollingEnabled`: boolean, default `true`.
- `collectorDevices.agentStateReason`: nullable `varchar(64)`.
- `collectorDevices.agentStateChangedAt`: nullable timestamptz.
- `collectorDevices.agentSessionId`: nullable `varchar(128)`.
- `mobileHeartbeatSchema` accepts `agentLifecycleState`, `pollingEnabled`, `agentStateReason`, `agentStateChangedAt`, and `agentSessionId`.

- [ ] **Step 1: Write the failing schema and payload tests**

Assert that the Drizzle table exposes all five lifecycle columns and that a heartbeat with `STOPPED`, `false`, `LOCAL_STOP_BUTTON`, and a session id parses successfully.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test apps/api/src/services/agent-lifecycle-contract.test.ts`
Expected: FAIL because the columns and schema fields do not exist.

- [ ] **Step 3: Add the schema fields, migration, and Zod fields**

Use existing varchar/boolean/timestamp conventions. The migration adds the columns with defaults matching the existing running-device behavior and does not alter command or business tables.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `bun test apps/api/src/services/agent-lifecycle-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add account-data-platform/packages/db/src/schema.ts account-data-platform/packages/db/src/migrations/0041_agent_lifecycle.sql account-data-platform/packages/types/src/api/mobile.ts account-data-platform/apps/api/src/services/agent-lifecycle-contract.test.ts
git commit -m "feat: 增加Agent实际生命周期契约"
```

### Task 2: Persist lifecycle events and reconcile commands

**Files:**
- Modify: `account-data-platform/apps/api/src/services/mobile.service.ts`
- Modify: `account-data-platform/apps/api/src/repositories/device.repository.ts`
- Modify: `account-data-platform/apps/api/src/repositories/command.repository.ts`
- Modify: `account-data-platform/apps/api/src/routes/mobile.ts`
- Test: `account-data-platform/apps/api/src/services/agent-disconnect-reconciliation.test.ts`

**Interfaces:**
- `saveHeartbeat()` persists lifecycle fields and calls `reconcileAgentDisconnect(deviceId, sessionId, reason)` for `STOPPED` or `pollingEnabled=false`.
- `reconcileAgentDisconnect()` atomically terminalizes all active business commands for the device, records `resultJson.status = "AGENT_DISCONNECTED"`, and clears active device runtime fields.
- `claimPendingCommandByDeviceId()` returns no business command when the device lifecycle is not `RUNNING` or polling is disabled.

- [ ] **Step 1: Write failing reconciliation tests**

Cover active `PENDING`/`RUNNING` commands, a duplicate stop event, and a new command claim while `pollingEnabled=false`. Assert one terminal transition, idempotent duplicate handling, and no claim.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test apps/api/src/services/agent-disconnect-reconciliation.test.ts`
Expected: FAIL because lifecycle fields are not persisted and command claim is not gated.

- [ ] **Step 3: Implement the transaction and claim gate**

Update the device row and active mobile commands under the existing per-device advisory lock. Use existing terminal command statuses and put `AGENT_DISCONNECTED`, `LOCAL_STOP_BUTTON`, and session data in `resultJson` without deleting history.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `bun test apps/api/src/services/agent-disconnect-reconciliation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add account-data-platform/apps/api/src/services/mobile.service.ts account-data-platform/apps/api/src/repositories/device.repository.ts account-data-platform/apps/api/src/repositories/command.repository.ts account-data-platform/apps/api/src/routes/mobile.ts account-data-platform/apps/api/src/services/agent-disconnect-reconciliation.test.ts
git commit -m "fix: 收口Agent断联时的旧任务"
```

### Task 3: Report local stop/start from AutoJS

**Files:**
- Modify: `mobile-agent/autojs/app/heartbeat.js`
- Modify: `mobile-agent/autojs/core/uploader.js`
- Modify: `mobile-agent/autojs/launcher.js`
- Create: `mobile-agent/autojs/app/agent-lifecycle-reporter.js`
- Test: `mobile-agent/autojs/tests/agent-lifecycle-reporter.test.js`

**Interfaces:**
- `createAgentLifecycleReporter({ config, uploader, storage, now })` exposes `reportStopped(reason, sessionId)` and `reportRunning(sessionId)`.
- `uploader.uploadHeartbeat()` forwards lifecycle fields unchanged.
- `stopAllScripts()` reports `STOPPED`/`pollingEnabled=false` before force-stopping scripts, then removes the local watchdog beat.
- Agent startup reports a new session id with `RUNNING`/`pollingEnabled=true`.

- [ ] **Step 1: Write the failing reporter and launcher-order tests**

Assert that stop reporting occurs before `stopEngines("main.js")`, that a lifecycle payload contains `LOCAL_STOP_BUTTON`, and that startup generates a new session id.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `node mobile-agent/autojs/tests/agent-lifecycle-reporter.test.js`
Expected: FAIL because the reporter and launcher hooks do not exist.

- [ ] **Step 3: Implement the reporter and wire existing uploader transport**

Reuse the existing signed uploader path; do not duplicate HMAC or create a new network dependency. Keep the reporter under 400 lines.

- [ ] **Step 4: Run the focused tests and syntax checks**

Run: `node mobile-agent/autojs/tests/agent-lifecycle-reporter.test.js` and `node --check mobile-agent/autojs/app/agent-lifecycle-reporter.js`
Expected: PASS with valid JavaScript syntax.

- [ ] **Step 5: Commit**

```bash
git add mobile-agent/autojs/app/heartbeat.js mobile-agent/autojs/core/uploader.js mobile-agent/autojs/launcher.js mobile-agent/autojs/app/agent-lifecycle-reporter.js mobile-agent/autojs/tests/agent-lifecycle-reporter.test.js
git commit -m "fix: 上报本地Agent启停生命周期"
```

### Task 4: Let external Agent run the existing safe cleanup

**Files:**
- Create: `mobile-agent/autojs/app/emergency-agent-cleanup.js`
- Modify: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/AgentRuntimeStopper.kt`
- Modify: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseControlCommandExecutor.kt`
- Modify: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseControlClient.kt`
- Create: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/AgentDisconnectCleanupCoordinator.kt`
- Test: `mobile-agent/android-base/tests/agent-disconnect-cleanup.test.js`

**Interfaces:**
- `emergency-agent-cleanup.js` invokes the existing `features/new-comment/cleanup.js` and writes an idempotent result to `AgriVideoCollectorEmergencyCleanup` storage.
- `AgentDisconnectCleanupCoordinator.run(deviceId, sessionId, reason)` stops the inner scripts, starts the isolated cleanup entry, waits with a bounded timeout, and returns `SUCCESS`, `PARTIAL`, or `FAILED` stage results.
- `BaseControlClient` includes cleanup stages and lifecycle resolution in the existing base command acknowledgement.

- [ ] **Step 1: Write failing tests for exact cleanup order and idempotency**

Assert `STOP_AGENT -> EXIT_DOUYIN -> OPEN_AGENT_HOME`, bounded timeout behavior, and duplicate invocation reuses the stored result.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node mobile-agent/android-base/tests/agent-disconnect-cleanup.test.js`
Expected: FAIL because the coordinator and emergency entry do not exist.

- [ ] **Step 3: Implement the coordinator by reusing existing cleanup modules**

The Kotlin layer only launches and waits for the isolated AutoJS cleanup script; it must not duplicate selectors or gesture coordinates. Any cleanup failure still returns a terminal result.

- [ ] **Step 4: Run the focused test and existing base tests**

Run: `node mobile-agent/android-base/tests/agent-disconnect-cleanup.test.js` and `node mobile-agent/android-base/tests/base-control-runtime.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile-agent/autojs/app/emergency-agent-cleanup.js mobile-agent/android-base/src/main/java/com/agri/video/collector/base/AgentRuntimeStopper.kt mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseControlCommandExecutor.kt mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseControlClient.kt mobile-agent/android-base/src/main/java/com/agri/video/collector/base/AgentDisconnectCleanupCoordinator.kt mobile-agent/android-base/tests/agent-disconnect-cleanup.test.js
git commit -m "feat: 由外部Agent执行断联安全收口"
```

### Task 5: Expose lifecycle state and user-facing feedback in Web

**Files:**
- Modify: `account-data-platform/apps/web/src/lib/api-client.ts`
- Modify: `account-data-platform/apps/web/src/lib/agent-command-channel.ts`
- Modify: `account-data-platform/apps/web/src/routes/DeviceList.tsx`
- Modify: `account-data-platform/apps/web/src/routes/VideoWarmupPage.tsx`
- Modify: `account-data-platform/apps/web/src/routes/AccountWarmupPage.tsx`
- Modify: `account-data-platform/apps/web/src/routes/LiveCommentEntryPage.tsx`
- Modify: `account-data-platform/apps/web/src/lib/account-warmup-form.ts`
- Modify: `account-data-platform/apps/web/src/lib/live-comment-entry-form.ts`
- Test: `account-data-platform/apps/web/tests/agent-disconnect-ui.test.js`

**Interfaces:**
- `DeviceRow` includes `agentLifecycleState`, `pollingEnabled`, `agentStateReason`, `agentStateChangedAt`, `agentSessionId`, and `cleanupStatus`.
- `isAgentCommandChannelOpen()` returns false unless lifecycle is `RUNNING`, polling is enabled, and the heartbeat is reachable.
- `agentDisconnectMessage(device)` returns the user-facing title, description, and recovery action.

- [ ] **Step 1: Write failing state-matrix and popup tests**

Cover stopped-with-task, stopped-without-task, heartbeat-timeout, and recovered-with-no-task. Assert both controls are disabled during disconnect and the recovery popup text is emitted once per state transition.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test apps/web/tests/agent-disconnect-ui.test.js`
Expected: FAIL because lifecycle fields and popup mapping are not present.

- [ ] **Step 3: Implement shared state mapping and page integration**

Keep disconnected rows visible as terminal “Agent 已断联” rows instead of filtering them out. Use Ant Design `message.info`/`notification.info` for transition feedback and a persistent inline status line. Disabled buttons must not rely on click handlers to explain themselves.

- [ ] **Step 4: Run the focused tests and Web build**

Run: `bun test apps/web/tests/agent-disconnect-ui.test.js` and `bun run --cwd apps/web build`
Expected: PASS and production build exit 0.

- [ ] **Step 5: Commit**

```bash
git add account-data-platform/apps/web/src/lib/api-client.ts account-data-platform/apps/web/src/lib/agent-command-channel.ts account-data-platform/apps/web/src/routes/DeviceList.tsx account-data-platform/apps/web/src/routes/VideoWarmupPage.tsx account-data-platform/apps/web/src/routes/AccountWarmupPage.tsx account-data-platform/apps/web/src/routes/LiveCommentEntryPage.tsx account-data-platform/apps/web/src/lib/account-warmup-form.ts account-data-platform/apps/web/src/lib/live-comment-entry-form.ts account-data-platform/apps/web/tests/agent-disconnect-ui.test.js
git commit -m "fix: 前端显示Agent断联并锁定业务操作"
```

### Task 6: Regression, documentation, and end-to-end verification

**Files:**
- Modify: `docs/项目开发/项目记录.md`
- Modify: `docs/项目开发/卡点与问题记录.md`
- Modify: `docs/项目开发/远程脚本模块/进度台账.md`
- Test: existing API, Web, AutoJS, and Android-base test suites

- [ ] **Step 1: Run all focused tests from Tasks 1-5**

Run the exact commands listed in each task and record the outputs.

- [ ] **Step 2: Run regression suites**

Run: `bun test` from `account-data-platform`, `node mobile-agent/autojs/tests/control-loop.test.js`, `node mobile-agent/android-base/tests/base-control-runtime.test.js`, and `node --check` for every modified AutoJS file.

- [ ] **Step 3: Run API and Web production builds**

Run: `bun run --cwd account-data-platform build` and `bun run --cwd account-data-platform typecheck`

- [ ] **Step 4: Verify the state matrix without a device**

Use API fixtures to verify stopped, cleanup-success, cleanup-failure, recovered, and old-session command-claim scenarios. ADB validation remains conditional on a connected device.

- [ ] **Step 5: Update project records**

Record changed files, test commands, known ADB limitation, and the final state-machine behavior in the three required project records.

- [ ] **Step 6: Commit documentation and final verification**

```bash
git add docs/项目开发/项目记录.md docs/项目开发/卡点与问题记录.md docs/项目开发/远程脚本模块/进度台账.md
git commit -m "docs: 记录Agent断联收口验证结果"
```

