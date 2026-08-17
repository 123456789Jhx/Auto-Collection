# 手动发布与远程脚本执行边界 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留采集任务和外部自动调度的前提下，建立管理员可控、可审计、可回传的手动视频发布入口，并让抖音与视频号按真实平台正确分流。

**Architecture:** 远程脚本继续只管理 `publish_video` 配置与设备绑定；发布任务页面负责创建执行实例。手动任务和外部任务统一落入 `publish_tasks`、统一生成 `PUBLISH_VIDEO_TASK`、统一由手机执行，但通过 `source` 区分是否回写 wecom。

**Tech Stack:** Bun、Hono、Drizzle/PostgreSQL、React/Ant Design、Auto.js CommonJS、Node test。

---

## 节点14A：采集与发布操作语义收敛

**Files:**
- Modify: `account-data-platform/apps/web/src/routes/DevicesPage.tsx`
- Modify: `account-data-platform/apps/web/tests/navigation-dashboard-status.test.js`
- Update: `docs/项目开发/项目记录.md`

- [ ] 先增加 Web 文本测试，要求设备操作显示“启动采集 / 暂停采集 / 停止采集”，并确认页面不存在含糊的独立“启动”按钮。
- [ ] 运行定向测试，确认旧文案导致失败。
- [ ] 只修改设备页显示文案和确认提示，不改变现有 `START/PAUSE/STOP` 命令。
- [ ] 运行 Web 定向测试、`bun run typecheck`、`bun run lint`。
- [ ] 浏览器确认按钮文案、设备状态和发布任务入口互不混淆。
- [ ] 提交：`git commit -m "明确设备采集操作语义"`。

**验收:** 点击“启动采集”后手机仍执行采集；后台没有产生 `PUBLISH_VIDEO_TASK`；用户不再把设备按钮理解成发布入口。

---

## 节点14B：双平台配置与命令契约

**Files:**
- Modify: `account-data-platform/apps/api/src/services/remote-script-registry.ts`
- Modify: `account-data-platform/apps/api/src/services/remote-script-registry.test.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-config.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-command.service.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-scheduler.service.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-scheduler.service.test.ts`
- Modify: `mobile-agent/autojs/tests/publish-video-flow.test.js`

- [ ] 在注册表测试中要求 `publish_video` 新增 `enabledPlatforms`，枚举仅允许 `DOUYIN`、`WECHAT_CHANNELS`，默认兼容为 `["DOUYIN"]`。
- [ ] 在命令测试中要求 `PUBLISH_VIDEO_TASK.payload.platform` 等于数据库任务的真实平台。
- [ ] 在调度测试中要求只领取配置允许的平台，并要求外部 PATCH 使用任务真实平台，禁止硬编码“抖音”。
- [ ] 运行测试确认三处契约均红灯。
- [ ] 实现 Schema、配置解析、逐平台调度和命令平台字段。
- [ ] 运行 API 定向测试、节点13/14 Node 测试、typecheck、lint。
- [ ] 通过动态表单创建同时启用双平台的配置并检查回显。
- [ ] 提交：`git commit -m "打通发布任务双平台契约"`。

**验收:** 抖音命令携带 `DOUYIN`，视频号命令携带 `WECHAT_CHANNELS`；手机入口按平台分流；旧配置默认只启用抖音。

---

## 节点14C：手动发布任务数据来源

**Files:**
- Modify: `account-data-platform/packages/db/src/publish-task-schema.ts`
- Create: `account-data-platform/packages/db/src/migrations/0026_publish_task_source.sql`
- Update: migration snapshot and journal
- Modify: `account-data-platform/packages/types/src/domain/publish-task.ts`
- Create: `account-data-platform/apps/api/src/repositories/manual-publish-task.repository.ts`
- Create: `account-data-platform/apps/api/src/repositories/manual-publish-task.repository.test.ts`

- [ ] 先写 Repository 集成测试，要求手动任务保存 `source=MANUAL`、`requestedBy`、内部 `taskId=manual:<uuid>`、平台、素材、文案、配置和设备。
- [ ] 运行测试确认字段不存在而失败。
- [ ] 新增 `source` 非空字段，默认 `EXTERNAL`；新增可空 `requested_by`，保证存量任务无须人工迁移。
- [ ] 生成并应用 0026 迁移。
- [ ] 实现手动任务创建 Repository，禁止调用外部领取接口。
- [ ] 运行 Repository 测试、typecheck、lint，并用 psql 检查默认值和索引。
- [ ] 提交：`git commit -m "增加手动发布任务来源"`。

**验收:** 存量任务均为 `EXTERNAL`；可独立创建 `MANUAL` 任务；尚不下发手机命令。

---

## 节点14D：管理员手动发布 API 与下发

**Files:**
- Modify: `account-data-platform/packages/types/src/domain/publish-task.ts`
- Create: `account-data-platform/apps/api/src/services/manual-publish-task.service.ts`
- Create: `account-data-platform/apps/api/src/services/manual-publish-task.service.test.ts`
- Create: `account-data-platform/apps/api/src/routes/manual-publish-tasks.ts`
- Modify: `account-data-platform/apps/api/src/routes/publish-tasks.ts`

- [ ] 定义请求契约：`configId/deviceId/platform/title/description/videoUrl/coverUrl?/confirmed`，其中 URL 仅允许 HTTP/HTTPS，`confirmed` 必须为 true。
- [ ] 写失败测试覆盖：未确认、配置停用、设备未启用、设备未绑定配置、平台未启用、账号绑定缺失、达到每日上限。
- [ ] 写成功测试，要求创建 `MANUAL` 任务、复用配置闸口值、生成一条 `PUBLISH_VIDEO_TASK` 并置 `DISPATCHED`。
- [ ] 运行测试确认 service/route 不存在。
- [ ] 实现 `POST /api/v1/admin/publish-tasks/manual`，只允许 adminAuth。
- [ ] 使用请求幂等键或客户端 requestId，防止连续点击产生重复发布。
- [ ] 运行定向测试、typecheck、lint。
- [ ] curl 创建一条测试任务并确认命令 payload 包含真实平台、素材、话题数和下载目录。
- [ ] 提交：`git commit -m "增加管理员手动发布下发接口"`。

**验收:** 不依赖 wecom，即可在后台创建一条合法发布任务并让真实设备轮询到 `PUBLISH_VIDEO_TASK`。

---

## 节点14E：手动任务结果、待人工与重试闭环

**Files:**
- Modify: `account-data-platform/apps/api/src/services/publish-task-result.service.ts`
- Modify: `account-data-platform/apps/api/src/services/publish-task-result.service.test.ts`
- Create: `account-data-platform/apps/api/src/services/manual-publish-retry.service.ts`
- Modify: `account-data-platform/apps/api/src/routes/publish-tasks.ts`

- [ ] 写测试要求 `source=MANUAL` 的成功/失败结果只更新本地任务，不调用 wecom PATCH。
- [ ] 保持 `source=EXTERNAL` 的原有外部回写行为不变。
- [ ] 写测试覆盖 `TOPIC_PENDING`、`MATERIAL_INVALID`、`CHANNELS_VERIFY_PENDING` 的人工状态。
- [ ] 定义 `POST /publish-tasks/:id/retry`，仅允许可重试状态，并为同一任务重置命令为 PENDING。
- [ ] 要求重试可更新 title、description、videoUrl、coverUrl，但不允许更换到未绑定设备。
- [ ] 实现结果分支与重试 service。
- [ ] 运行定向测试、typecheck、lint。
- [ ] curl 完成手动任务：下发 → 回传 SUCCEEDED → 本地 REPORTED，mock-wecom 请求数保持 0。
- [ ] 提交：`git commit -m "闭环手动发布结果与重试"`。

**验收:** 手动任务成功不依赖外部系统；三个待人工状态均可修正后重新下发；外部任务行为无回归。

---

## 节点14F：发布任务页手动发布界面

**Files:**
- Create: `account-data-platform/apps/web/src/routes/ManualPublishTaskModal.tsx`
- Create: `account-data-platform/apps/web/src/routes/PublishTaskRetryModal.tsx`
- Modify: `account-data-platform/apps/web/src/lib/api-client-publish-tasks.ts`
- Modify: `account-data-platform/apps/web/src/routes/PublishTasksPage.tsx`
- Modify: `account-data-platform/apps/web/tests/publish-tasks-page.test.js`

- [ ] 先写 Web 测试，要求页面有“手动发布”，并且设备、配置、平台、标题、描述、视频 URL、封面 URL、真实发布确认均存在。
- [ ] 要求未勾选确认、URL 非 HTTP/HTTPS、话题少于配置预期时阻止提交。
- [ ] 运行测试确认 Modal 不存在。
- [ ] 新建独立 Modal；配置选择后只展示其绑定且启用的设备和允许平台。
- [ ] 手动发布成功后关闭 Modal、刷新统计和表格，并高亮新任务。
- [ ] 对三个待人工状态提供“修正并重试”操作；普通 FAILED 展示错误后允许重试。
- [ ] 运行 Web 测试、typecheck、lint。
- [ ] 浏览器完成抖音和视频号各一条表单校验，不实际点击最终确认前保存截图。
- [ ] 提交：`git commit -m "增加手动发布与重试页面"`。

**验收:** 用户不再通过设备“启动”猜测执行哪个脚本；所有真实发布操作集中在发布任务页并要求二次确认。

---

## 节点14G：双平台端到端与真机验收

**Files:**
- Update: `docs/项目开发/项目记录.md`
- Update: `docs/项目开发/设备与联调记录/设备与联调记录.md`
- Update: `docs/项目开发/远程脚本模块/进度台账.md`

- [ ] 运行 API/Web/mobile 全部定向测试、typecheck、lint 和手机脚本语法检查。
- [ ] 确认 API 3012、Web 3022、手机局域网访问和业务版本。
- [ ] 手动创建抖音任务，观察下载、相册、封面、话题、发布、SUCCEEDED/REPORTED。
- [ ] 创建话题不足任务，验证 `TOPIC_PENDING` → 修正文案 → 重试成功。
- [ ] 创建素材错误任务，验证 `MATERIAL_INVALID` → 更换 URL → 重试。
- [ ] 手动创建视频号任务，确认 payload 平台、微信启动校正和完整发布流程。
- [ ] 若出现验证弹窗，确认 `CHANNELS_VERIFY_PENDING` 且脚本不尝试绕过；人工处理后重试。
- [ ] 连续下发抖音、视频号任务，确认同一设备按命令顺序串行执行。
- [ ] 保存任务页面、设备状态、日志中心截图和命令/结果数据库证据。
- [ ] 更新台账状态并提交：`git commit -m "完成手动发布双平台真机验收"`。

**验收:** 管理员能够在不依赖 wecom 的情况下完成双平台真实发布；采集、自动外部发布和手动发布三条链路边界清楚且互不干扰。

---

## 节点15：wecom 真实接口联调

节点14G通过后再执行既有节点15。将 `source=EXTERNAL` 的领取、账号匹配、自动调度、手机执行和外部状态 PATCH 跑通；不再改动手动发布架构。
