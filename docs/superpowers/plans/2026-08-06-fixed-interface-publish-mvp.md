# 固定接口单设备发布 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用当前固定 URL 和后端环境 Token，移除接口配置编辑入口，并让唯一测试设备完成一次真实接口发布闭环。

**Architecture:** 继续复用现有 `remote_script_configs`、`configId`、接口发布 worker、outbox 和成熟手机动作。固定 URL 写入一条现有配置记录，Token 只通过 `PUBLISH_EXTERNAL_TOKEN` 读取；暂停凭据表和 Token 管理界面。

**Tech Stack:** Bun、TypeScript、Hono、Drizzle ORM、PostgreSQL、React、TanStack Query、Ant Design、AutoJS

**Authoritative design:** `docs/superpowers/specs/2026-08-06-fixed-interface-publish-mvp-design.md`

---

### Task 1: 撤销未完成的凭据持久化增量

**Files:**
- Delete: `account-data-platform/packages/types/src/domain/publish-interface-config.ts`
- Delete: `account-data-platform/packages/types/src/domain/publish-interface-config.test.ts`
- Delete: `account-data-platform/packages/db/src/publish-interface-credential-schema.test.ts`
- Delete: `account-data-platform/packages/db/src/migrations/0031_publish_interface_credentials.sql`
- Modify: `account-data-platform/packages/types/src/index.ts`
- Modify: `account-data-platform/packages/db/src/schema-remote-script.ts`
- Modify: `account-data-platform/packages/db/src/migrations/meta/_journal.json`
- Modify: `account-data-platform/apps/api/src/services/publish-config.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-config.test.ts`
- Modify: `account-data-platform/apps/api/src/services/remote-script-registry.ts`
- Modify: `account-data-platform/apps/api/src/services/remote-script-registry.test.ts`
- Modify: `account-data-platform/apps/api/src/services/remote-script.service.ts`
- Modify: `account-data-platform/apps/api/src/services/remote-script.service.test.ts`
- Modify: `account-data-platform/apps/api/src/services/wecom-publish-client.ts`
- Modify: `account-data-platform/apps/api/src/services/wecom-publish-client.test.ts`

- [ ] **Step 1: 删除只属于暂停方案的新文件**

删除两个专用配置契约文件、凭据表结构测试和 0031 迁移。不得删除此前已有的接口发布运行表、0030 迁移或其他用户文件。

- [ ] **Step 2: 从既有文件精确移除本次增量**

恢复固定环境变量契约：

```ts
const externalPullPublishConfigSchema = publishExecutionConfigSchema.extend({
  sourceMode: z.literal("external_pull").default("external_pull"),
  externalBaseUrl: z.string().url(),
  externalTokenEnv: z.string().min(1),
  publishTimeSlots: timeSlotSchema,
  platforms: z.array(z.enum(["抖音", "视频号"])).min(1).max(2).default(["抖音", "视频号"])
}).strip();

export const publishClientOnlyConfigSchema = z.object({
  externalBaseUrl: z.string().url(),
  externalTokenEnv: z.string().min(1)
}).passthrough();
```

恢复客户端配置：

```ts
export type WecomPublishClientConfig = {
  externalBaseUrl: string;
  externalTokenEnv: string;
};

function tokenFor(config: WecomPublishClientConfig) {
  const token = process.env[config.externalTokenEnv];
  if (!token) {
    throw new WecomPublishClientError(
      0,
      "EXTERNAL_TOKEN_ENV_MISSING",
      `环境变量 ${config.externalTokenEnv} 未配置`
    );
  }
  return token;
}
```

同时执行以下精确清理：

- 从类型 barrel 只移除 `publish-interface-config` 导出，不改其他既有导出。
- 从 schema 只移除 `publishInterfaceCredentials` 表；若 `text` 仍被其他表使用则保留 import。
- 从 journal 只移除 idx 31，保留 0-30 原样。
- registry 的 `external_pull` required 恢复为 `externalBaseUrl` 和 `externalTokenEnv`。
- remote-script service 恢复为始终校验必填环境变量名。
- 测试恢复固定环境变量必填和默认双平台的原有预期。
- 不回退 notification、账号预热、接口 worker 或其他预先存在的工作区改动。

- [ ] **Step 3: 验证暂停方案已完全移除**

Run: `cd account-data-platform; rg -n "publishInterfaceCredentials|publish-interface-config|PUBLISH_CREDENTIAL_ENCRYPTION_KEY" packages apps`

Expected: no matches。

Run: `cd account-data-platform; bun test apps/api/src/services/publish-config.test.ts apps/api/src/services/remote-script-registry.test.ts apps/api/src/services/remote-script.service.test.ts apps/api/src/services/wecom-publish-client.test.ts packages/db/src/publish-interface-schema.test.ts`

Expected: PASS。

Run: `cd account-data-platform; bun run typecheck`

Expected: PASS。

### Task 2: 固定前端入口并初始化唯一接口配置

**Files:**
- Modify: `account-data-platform/apps/web/src/routes/PublishSchedulesPage.tsx`
- Modify: `account-data-platform/apps/web/tests/interface-publish-end-to-end.test.js`
- Modify: `account-data-platform/apps/web/tests/publish-video-module.test.js`
- Data: existing `remote_script_configs` table through `/api/v1/admin/remote-scripts/configs`

- [ ] **Step 1: 写固定只读入口的失败测试**

在前端测试中增加：

```js
assert(!schedules.includes("RemoteScriptsContent"));
assert(!schedules.includes("新建远程脚本配置"));
assert(!schedules.includes("Token 环境变量名"));
assert(schedules.includes("固定接口连接"));
assert(schedules.includes("测试连接"));
assert(schedules.includes("InterfacePublishBindingsPanel"));
assert(schedules.includes("InterfacePublishRunControl"));
assert(schedules.includes("InterfacePublishRunMonitor"));
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd account-data-platform; bun test apps/web/tests/interface-publish-end-to-end.test.js apps/web/tests/publish-video-module.test.js`

Expected: FAIL because `PublishSchedulesPage` still renders `RemoteScriptsContent`。

- [ ] **Step 3: 移除通用编辑器并保留只读固定接口**

在 `PublishSchedulesPage.tsx`：

- 删除 `RemoteScriptsContent` import 和页面底部实例。
- 保留 `getRemoteScriptConfigs` 只读查询、固定接口表格和测试连接按钮。
- 将 section 标题改为 `固定接口连接`。
- 将空状态改为 `固定接口配置尚未初始化`。
- 保留匹配设备、运行控制和运行监控，不修改其行为。
- 运行控制只接收查询到的 `ENABLED` 固定配置。

- [ ] **Step 4: 运行前端测试与类型检查**

Run: `cd account-data-platform; bun test apps/web/tests/interface-publish-end-to-end.test.js apps/web/tests/publish-video-module.test.js && bun --filter @app/web typecheck`

Expected: PASS。

- [ ] **Step 5: 通过现有后端 API 一次性创建固定配置**

先查询 `publish_video + external_pull` 配置。只有查询结果为空时才 POST，避免重复配置。请求体不得包含 Token 明文：

```json
{
  "scriptKey": "publish_video",
  "configName": "固定接口发布",
  "status": "ENABLED",
  "remark": "固定接口单设备 MVP",
  "configPayload": {
    "sourceMode": "external_pull",
    "responseDelayMsMin": 700,
    "responseDelayMsMax": 1200,
    "actionWaitMsMin": 900,
    "actionWaitMsMax": 1500,
    "expectedTopicCount": 5,
    "requireCover": true,
    "topicResolveTimeoutMinutes": 30,
    "downloadDir": "/sdcard/",
    "isDefault": true,
    "externalBaseUrl": "https://wecom.dafengchan.top",
    "externalTokenEnv": "PUBLISH_EXTERNAL_TOKEN",
    "publishTimeSlots": [],
    "platforms": ["抖音"]
  }
}
```

Expected: HTTP 201 once; subsequent reads return exactly one enabled fixed config. Confirm serialized database/API data does not contain the external Token value.

### Task 3: 完成固定接口单设备真机闭环

**Files:**
- No production file changes expected.
- Runtime evidence comes from existing API, database, device heartbeat, worker, monitor and external mock/real responses.

- [ ] **Step 1: 运行自动化回归**

Run: `cd account-data-platform; bun test`

Expected: all tests pass; baseline was 370 pass / 0 fail before MVP edits。

Run: `cd account-data-platform; bun run typecheck && bun run build`

Expected: PASS。

- [ ] **Step 2: 检查固定运行前提**

Verify without exposing secrets:

- API `3012` and web `3024` are listening.
- `PUBLISH_EXTERNAL_TOKEN` is non-empty in backend environment.
- Fixed config is enabled and points at the confirmed URL/environment-variable name.
- Device `device_03be8de3a35ae0ce` heartbeat is online.
- Device account binding is exactly `开心幸福一家人 / 41218954470` and unique.
- APK version is `1.0.72` or newer; business scripts are `1.3.14.20260806101655` or newer.

- [ ] **Step 3: 测试固定接口连接**

Call existing backend endpoint:

```text
POST /api/v1/admin/publish-schedules/{configId}/test-connection
```

Expected: reachable result. Authentication failure stops the run and reports only the error code/message, never the Token.

- [ ] **Step 4: 创建单设备运行**

Select the fixed config returned by Task 2. Set `maxConcurrentPublishing` to `1`; the backend adds `noMaterialRetryMinutes: 10`, `timezone: Asia/Shanghai`, and `platform: DOUYIN` through the existing run-control contract.

Choose UI times by the current Shanghai clock:

- Before 11:55: set morning to the next whole minute at least three minutes ahead; set afternoon to a later valid time.
- From 12:00 through 12:59: keep morning at 09:00 and set afternoon to 13:05 or later.
- From 13:00 through 23:55: keep morning at 09:00 and set afternoon to the next whole minute at least three minutes ahead.
- After 23:55: do not create a same-day run; perform the test on the next business day.

Run the existing preflight and confirm APIs. Do not skip the current matched binding. Verify one active run and one run-local binding snapshot.

- [ ] **Step 5: 观察真实领取与手机执行**

At publish time verify this sequence:

```text
slot eligible
-> claim account 开心幸福一家人
-> validate/convert material URLs
-> create one local publish task
-> dispatch one existing phone command
-> device fetches command
-> mature Douyin publish action runs
-> device reports terminal result
-> outbox PATCHes external task status
```

No additional device may receive a publish command. Do not manually retry a claim with unknown outcome.

- [ ] **Step 6: 验收结果并记录故障阶段**

Success requires:

- one external task claimed for the bound account;
- one phone command and one local publish task;
- phone reports `PUBLISHED` with no duplicate execution;
- local slot is credited;
- external PATCH reaches `已发布`;
- monitor has no unresolved flow/execution/sync alert;
- logs and payloads contain no Token.

If it fails, classify the first failing boundary as one of: external interface, backend flow, phone action, external status sync. Preserve evidence and stop before adding a second device.

- [ ] **Step 7: 保护文档与动作脚本检查**

Run: `Get-FileHash 'C:\Users\21595\Documents\Codex\2026-08-05\dui\outputs\通过接口发布视频架构设计.md' -Algorithm SHA256`

Expected: `D7536974D0E13068B8BA1A71D29BE3DB8491E371D1204EA327373C8A8E5FD50B`。

Confirm this MVP introduced no new changes under `mobile-agent/autojs/features/publish-video`.
