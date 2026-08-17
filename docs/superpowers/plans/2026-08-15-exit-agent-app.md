# 退出燎原星火功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不停止外层底座或心跳、不改变已有启动/打开配置的前提下，新增一个可幂等执行的 `EXIT_AGENT_APP` 复合命令，用于停止内层 Agent、移除燎原星火界面任务，并按用户选择锁屏。

**Architecture:** 复用现有移动命令、BASE 专属轮询和设备快照。共享类型层定义严格的命令 payload 与逐阶段 ACK 结果；API 将新命令路由到 BASE 并保留相同 `commandId` 的幂等结果；Android BASE 串行执行“前置检查 -> 停止脚本 -> 移除 UI 任务 -> 可选锁屏”，Web 仅在在线且快照完整时展示四态提示并提交确认后的命令。

**Tech Stack:** Bun/Hono/TypeScript/Zod, React 19/Ant Design, Kotlin Android, Node `node:test`, Bun test.

---

### Task 1: 扩展共享命令与结果合同

**Files:**
- Modify: `account-data-platform/packages/types/src/api/admin.ts` (移动命令类型枚举)
- Modify: `account-data-platform/packages/types/src/api/mobile.ts` (命令 payload 与 BASE ACK schema)
- Modify: `account-data-platform/apps/api/src/services/command-executor.ts` (BASE 路由集合)
- Modify: `account-data-platform/apps/api/src/services/agent-control.ts` (退出命令不参与 START/STOP 状态覆盖)
- Test: `account-data-platform/packages/types/src/api/agent-base-contract.test.ts`
- Test: `account-data-platform/apps/api/src/services/command-executor.test.ts`
- Test: `account-data-platform/apps/api/src/services/agent-control.test.ts`

- [ ] **Step 1: Write failing contract tests**

  Add assertions that `EXIT_AGENT_APP` is accepted as a mobile command, rejects a non-boolean or unknown `lockScreen` payload, routes only to `BASE`, and is not included in the START/STOP supersession set. Add ACK fixtures allowing `DONE`, `PARTIAL`, and `FAILED` business results while transport status remains `DONE` or `FAILED`.

- [ ] **Step 2: Run focused tests and verify they fail**

  Run from `account-data-platform/`:

  ```text
  bun test packages/types/src/api/agent-base-contract.test.ts apps/api/src/services/command-executor.test.ts apps/api/src/services/agent-control.test.ts
  ```

  Expected: failures because the new command is absent from the enum and BASE set.

- [ ] **Step 3: Implement the minimal schemas and routing**

  Define `exitAgentAppPayloadSchema = z.object({ lockScreen: z.boolean().default(false) }).strict()`, add `EXIT_AGENT_APP` to the existing command union, and validate this payload in `createCommand`. Extend `mobileBaseCommandAckSchema` with the existing transport statuses and require the result object to carry `commandType`, `result`, and `stages` at runtime through a dedicated schema. Keep `EXIT_AGENT_APP` out of `desiredAgentStateForCommand` and out of supersession lists.

- [ ] **Step 4: Run focused tests and verify they pass**

  Re-run the command above. Expected: PASS, with existing START/STOP/OPEN tests unchanged.

- [ ] **Step 5: Commit only the contract files**

  ```text
  git add account-data-platform/packages/types/src/api/admin.ts account-data-platform/packages/types/src/api/mobile.ts account-data-platform/apps/api/src/services/command-executor.ts account-data-platform/apps/api/src/services/agent-control.ts account-data-platform/packages/types/src/api/agent-base-contract.test.ts account-data-platform/apps/api/src/services/command-executor.test.ts account-data-platform/apps/api/src/services/agent-control.test.ts
  git commit -m "feat: add exit agent app command contract"
  ```

### Task 2: Make BASE execution staged, serial, and idempotent

**Files:**
- Modify: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseControlCommandExecutor.kt`
- Modify: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/AppUiForegroundController.kt`
- Modify: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseControlClient.kt`
- Modify: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/BaseControlRuntime.kt`
- Create: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/AgentRuntimeStopper.kt`
- Create: `mobile-agent/android-base/src/main/java/com/agri/video/collector/base/ScreenLockController.kt`
- Test: `mobile-agent/android-base/tests/base-control-command-executor.test.js`
- Test: `mobile-agent/android-base/tests/app-ui-foreground-controller.test.js`

- [ ] **Step 1: Write failing source-contract tests**

  Assert that the executor recognizes `EXIT_AGENT_APP`, invokes a normalized-path stopper for `main.js` and `watchdog.js`, calls a UI-task removal method rather than `force-stop package`, preserves `BaseConnectivityService`, stops after the first failed stage, serializes per-device execution, and encodes `DONE`/`PARTIAL`/`FAILED` plus stage statuses in the ACK result. Assert `lockScreen` defaults to false and lock-screen failure is reported as partial after successful cleanup.

- [ ] **Step 2: Run Android source tests and verify they fail**

  ```text
  node --test mobile-agent/android-base/tests/base-control-command-executor.test.js mobile-agent/android-base/tests/app-ui-foreground-controller.test.js
  ```

  Expected: missing executor branch and missing stopper/removal/lock classes.

- [ ] **Step 3: Implement the staged executor**

  Add a result model containing `commandType`, business `result`, and ordered stage records. For `EXIT_AGENT_APP`, parse `command.payload["lockScreen"]` as a boolean, reject malformed input before changing state, guard execution with a per-device lock, call `AgentRuntimeStopper.stop()` (return `SKIPPED/ALREADY_STOPPED` when both scripts are absent), then `AppUiForegroundController.removeTask()` (return `SKIPPED/NO_UI_TASK` when no matching task exists), and finally `ScreenLockController.lock()` only when requested. Never invoke package force-stop or stop the connectivity service. Update `BaseControlClient.acknowledge` to map successful cleanup plus lock failure to transport `DONE` with business `PARTIAL`, while a prerequisite/stage failure maps to transport `FAILED` and business `FAILED`; preserve cached command ACKs for duplicate command IDs.

- [ ] **Step 4: Run source tests and static checks**

  ```text
  node --test mobile-agent/android-base/tests/base-control-command-executor.test.js mobile-agent/android-base/tests/app-ui-foreground-controller.test.js mobile-agent/android-base/tests/base-connectivity-contract.test.js
  node --check mobile-agent/android-base/tests/base-control-command-executor.test.js
  ```

  Expected: PASS; the connectivity contract must continue to prove that heartbeat code has no lifecycle command handling.

- [ ] **Step 5: Commit Android execution changes**

  ```text
  git add mobile-agent/android-base/src/main/java/com/agri/video/collector/base mobile-agent/android-base/tests/base-control-command-executor.test.js mobile-agent/android-base/tests/app-ui-foreground-controller.test.js
  git commit -m "feat: execute exit agent app in base layer"
  ```

### Task 3: Add Web state matrix and confirmation flow

**Files:**
- Modify: `account-data-platform/apps/web/src/features/remote-wake/RemoteWakeDeviceAction.tsx`
- Modify: `account-data-platform/apps/web/src/features/remote-wake/remote-wake-action-plan.ts`
- Modify: `account-data-platform/apps/web/src/features/remote-wake/RemoteWakePage.tsx`
- Modify: `account-data-platform/apps/web/src/lib/api-client.ts`
- Test: `account-data-platform/apps/web/tests/remote-wake-action-plan.test.ts`
- Test: `account-data-platform/apps/web/tests/remote-wake-management.test.js`
- Create: `account-data-platform/apps/web/tests/exit-agent-app.test.ts`

- [ ] **Step 1: Write failing state-matrix tests**

  Cover offline/incomplete snapshot (information only, no command), Agent stopped plus no UI task (information-only “我知道了”), Agent stopped plus UI task (confirm removal), Agent running plus no UI task (confirm stop), and Agent running plus UI task (confirm stop then remove). Add a lock-screen option whose default is false and assert the submitted payload is `{ lockScreen: false|true }`.

- [ ] **Step 2: Run Web tests and verify they fail**

  ```text
  bun test apps/web/tests/remote-wake-action-plan.test.ts apps/web/tests/exit-agent-app.test.ts apps/web/tests/remote-wake-management.test.js
  ```

  Expected: no exit action or button exists yet.

- [ ] **Step 3: Implement the plan and UI**

  Add a separate `EXIT_AGENT_APP` action plan with explicit `info` versus `confirm` outcomes. Keep `OPEN_AGENT_APP` and `START_AGENT` behavior untouched. In the action component, render a separate exit button, show the current snapshot in the dialog, provide an unchecked lock-screen switch, disable duplicate confirmation while submitting, and retain the returned `commandId`/status for refresh-safe display. Do not submit when base state or snapshot is unknown.

- [ ] **Step 4: Run Web typecheck, focused tests, and production build**

  ```text
  bun test apps/web/tests/remote-wake-action-plan.test.ts apps/web/tests/exit-agent-app.test.ts apps/web/tests/remote-wake-management.test.js
  bun run --cwd apps/web typecheck
  bun run --cwd apps/web build:prod
  ```

  Expected: all tests pass and the existing open/start actions remain covered.

- [ ] **Step 5: Commit Web changes**

  ```text
  git add account-data-platform/apps/web/src/features/remote-wake account-data-platform/apps/web/src/lib/api-client.ts account-data-platform/apps/web/tests/remote-wake-action-plan.test.ts account-data-platform/apps/web/tests/remote-wake-management.test.js account-data-platform/apps/web/tests/exit-agent-app.test.ts
  git commit -m "feat: add exit agent app controls"
  ```

### Task 4: Verify API integration and regression boundaries

**Files:**
- Modify: `account-data-platform/apps/api/src/services/command.service.ts` (payload validation and idempotency key handling only if required by tests)
- Modify: `account-data-platform/apps/api/src/routes/mobile.ts` (only if ACK schema response needs explicit result passthrough)
- Test: `account-data-platform/apps/api/src/services/command-executor.test.ts`
- Test: `account-data-platform/apps/api/src/routes/mobile-publish-tasks.test.ts` (regression selection only; do not alter unrelated expectations)

- [ ] **Step 1: Add API integration tests**

  Verify `EXIT_AGENT_APP` is accepted through the existing mobile command creation path, always routes to BASE polling, accepts a repeated idempotency key/command ID without a second execution, and preserves staged result JSON when acknowledged.

- [ ] **Step 2: Run API tests and verify the new assertions fail before integration changes**

  ```text
  bun test apps/api/src/services/command-executor.test.ts apps/api/src/services/agent-control.test.ts apps/api/src/routes/mobile-publish-tasks.test.ts
  ```

- [ ] **Step 3: Implement only missing integration wiring**

  Reuse `createCommand`, `pollCommands`, `acknowledgeBaseCommand`, and repository idempotency behavior. Do not add a parallel endpoint or alter existing desired-agent-state updates. Ensure business `PARTIAL` remains visible in `resultJson` even when transport status is `DONE`.

- [ ] **Step 4: Run full relevant verification**

  ```text
  bun test packages/types/src/api apps/api/src/services/command-executor.test.ts apps/api/src/services/agent-control.test.ts apps/api/src/routes/mobile-publish-tasks.test.ts
  bun run --cwd apps/api typecheck
  node --test mobile-agent/android-base/tests/*.test.js
  bun run --cwd apps/web typecheck
  ```

  Expected: PASS, with no changes to existing START_AGENT, OPEN_AGENT_APP, heartbeat, boot, or configuration tests.

- [ ] **Step 5: Commit integration and documentation updates**

  Update the required project progress log under `docs/项目开发/远程脚本模块/进度台账.md` and project record under `docs/项目开发/项目记录.md` with the new command and verification results, then commit only those files plus API tests.

## Self-review checklist

- The four Web state combinations and offline/unknown guard are covered.
- `lockScreen=false` is the default; lock failure produces business `PARTIAL`.
- No code path uses package force-stop or stops `BaseConnectivityService`/heartbeat.
- Duplicate command IDs are acknowledged from cached results and do not rerun stages.
- Existing START_AGENT, OPEN_AGENT_APP, boot, heartbeat, and configuration behavior remains unchanged.
- Every test command above is executable from the stated directory; no placeholder tasks remain.
