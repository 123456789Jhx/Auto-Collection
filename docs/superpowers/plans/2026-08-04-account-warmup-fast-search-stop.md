# 养号快速搜索与停止任务 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将养号搜索阶段压缩到 8～15 秒，并提供可即时反馈、ACK 后返回 Agent 的批次停止操作。

**Architecture:** 新增养号专用快速搜索业务脚本，通过注册表启动预加载并注入目标直播任务，不修改超限的通用抖音适配器。前端复用现有 STOP API，以本地停止请求集合提供即时状态；APK 桥接器只负责终态 ACK 后返回 Agent。

**Tech Stack:** AutoX.js/CommonJS、React 19、Ant Design、TanStack Query、Bun/Node tests、ADB。

---

### Task 1: 养号专用快速搜索

**Files:**
- Create: `mobile-agent/autojs/features/account-warmup/fast-target-search.js`
- Create: `mobile-agent/autojs/tests/account-warmup-fast-target-search.test.js`
- Modify: `mobile-agent/autojs/features/account-warmup/registry.js`
- Modify: `mobile-agent/autojs/features/account-warmup/target-live-entry.js`

- [x] **Step 1: 写失败测试**

覆盖节点搜索入口、坐标兜底、输入、提交、结果确认、阶段超时和四段耗时日志；注册表测试要求启动阶段加载 `fast-target-search.js`。

- [x] **Step 2: 运行 RED**

Run: `node mobile-agent/autojs/tests/account-warmup-fast-target-search.test.js && node mobile-agent/autojs/tests/account-warmup-registry.test.js`

Expected: 快速搜索模块不存在或注册表未加载新模块。

- [x] **Step 3: 实现最小快速搜索**

接口固定为：

```js
function createFastTargetSearch(options) {
  return {
    openSearch: function (keyword, control) {
      return { success: true, stage: "result_confirmed", elapsedMs: 0 };
    }
  };
}
```

生产实现使用带截止时间的 `findOnce` 轮询，入口坐标兜底、`setText` 输入、按钮或回车提交，并通过关键词与搜索结果标记确认成功。每个阶段写 `养号快速搜索阶段完成` 日志。

- [x] **Step 4: 接入目标任务**

注册表预加载快速搜索模块并注入 `createTargetLiveEntryTask({ fastSearch })`；目标任务将 `runtime.openSearch` 改为该实例，并在搜索前后检查 `shouldStop`。

- [x] **Step 5: 运行 GREEN**

Run: `node mobile-agent/autojs/tests/account-warmup-fast-target-search.test.js; node mobile-agent/autojs/tests/account-warmup-registry.test.js; node mobile-agent/autojs/tests/account-warmup-target-live.test.js`

Expected: 全部退出码 0。

### Task 2: STOP ACK 后返回 Agent

**Files:**
- Modify: `mobile-agent/autojs/app/account-warmup-command-bridge.js`
- Modify: `mobile-agent/autojs/tests/account-warmup-command-bridge.test.js`

- [x] **Step 1: 写失败测试**

测试 `STOPPED` 结果必须先调用运行命令 ACK，再调用注入的 `returnToAgent()`；ACK 失败时不得返回 Agent。

- [x] **Step 2: 运行 RED**

Run: `node mobile-agent/autojs/tests/account-warmup-command-bridge.test.js`

Expected: 未调用 `returnToAgent` 或调用顺序不匹配。

- [x] **Step 3: 实现终态顺序**

`finishCommand()` 在 ACK 成功并清理 active 后调用 `returnToAgentAfterStop()`；默认实现使用 Agent 包名启动应用，失败只写 WARN。

- [x] **Step 4: 运行 GREEN**

Run: `node mobile-agent/autojs/tests/account-warmup-command-bridge.test.js`

Expected: 退出码 0，断言顺序为 `ack → return-agent`。

### Task 3: 前端停止任务即时状态

**Files:**
- Modify: `account-data-platform/apps/web/src/routes/AccountWarmupPage.tsx`
- Modify: `account-data-platform/apps/web/src/lib/account-warmup-form.ts`
- Modify: `account-data-platform/apps/web/tests/account-warmup-page.test.js`

- [x] **Step 1: 写失败测试**

测试状态映射接受 `stopRequested=true` 并返回“停止中”；页面必须包含“停止任务”，不再包含“全部停止”。

- [x] **Step 2: 运行 RED**

Run: `bun test apps/web/tests/account-warmup-page.test.js`

Expected: 状态映射签名或页面文案断言失败。

- [x] **Step 3: 实现停止请求集合**

页面维护 `Set<string>`；点击批次或单设备停止时立即加入命令 ID，按钮禁用并显示 loading。使用 `Promise.allSettled` 保留成功设备，失败设备恢复原状态并报告数量。

- [x] **Step 4: 运行 GREEN**

Run: `bun test apps/web/tests/account-warmup-page.test.js`

Expected: 退出码 0。

### Task 4: 回归、发布与真机验收

**Files:**
- Modify: `mobile-agent/autojs/project.json`
- Modify: `docs/项目开发/卡点与问题记录.md`
- Modify: `docs/项目开发/远程脚本模块/进度台账.md`
- Modify: `docs/项目开发/项目记录.md`

- [x] **Step 1: 定向与全量验证**

运行养号 AutoJS 测试、Web 定向测试、`bun test`、`bun run typecheck`、`bun run lint`、`bun run build`、`node --check`、400 行检查与 `git diff --check`。

- [x] **Step 2: 发布 biz-scripts**

打包并发布下一版 `biz-scripts`，确认 ZIP 包含快速搜索、注册表和目标直播任务，下载 SHA 与 manifest 一致。

- [x] **Step 3: 构建并安装 APK**

版本提升为 `1.0.69 / 105`，验证签名、SHA 和包内桥接器后使用 `adb install -r` 覆盖安装。

- [ ] **Step 4: 真机验收**

验证搜索四段日志总耗时 8～15 秒；点击“停止任务”后确认前端立即显示停止中、手机 ACK `STOPPED`、随后返回燎原星火。

- [x] **Step 5: 同步记录**

记录旧搜索约 90 秒、优化后真实耗时、STOP ACK 顺序、发布版本、APK 哈希和未修改 OCR/滑动策略的边界。
