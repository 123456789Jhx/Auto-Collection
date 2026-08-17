# 02-同设备串行与 PUBLISH_BUSY

## 目标

实现“同设备不排队”的后端调度语义。

确认后的业务规则是：

- 手机端不排队。
- 后端发现设备忙时，不创建新的 `PUBLISH_VIDEO_TASK`。
- 后端按默认策略延迟重试：**最多 3 次，每次间隔 5 分钟**。
- 重试耗尽后，才把任务回写为未发布，原因 `PUBLISH_BUSY`。
- 移动端已有本地发布锁和 `PUBLISH_BUSY` 防御，但它不是主要排队控制点。

## 当前问题

前序只读核对发现：

- 后端 `dispatchMatchedPublishTask()` 匹配成功后直接创建移动端命令。
- `mobile_commands` 查询最多返回 10 条 pending/fetched 命令，实际支持排队。
- 当前没有后端 busy 检查。
- 当前没有 `PUBLISH_BUSY` 本地状态、失败码、重试字段和看板统计。
- 同一 slot 中抖音和视频号连续命中同一设备时，会连续创建两个 `PUBLISH_VIDEO_TASK`。

## 不要改什么

- 不要把 busy 重试放到手机端。
- 不要让手机端轮询时拿到多个发布命令后自己排队。
- 不要 busy 一出现就最终回写外部失败；需要先按 3 次 / 5 分钟重试。
- 不要让话题补全重下发被当前任务自己的旧命令误判 busy。
- 不要影响非发布命令的轮询和 ACK 逻辑。

## 涉及文件

- `account-data-platform/apps/api/src/services/publish-scheduler.service.ts`
- `account-data-platform/apps/api/src/services/publish-command.service.ts`
- `account-data-platform/apps/api/src/repositories/command.repository.ts`
- `account-data-platform/apps/api/src/repositories/publish-dispatch.repository.ts`
- `account-data-platform/apps/api/src/repositories/publish-task.repository.ts`
- `account-data-platform/apps/api/src/services/publish-status-outbox.service.ts`
- `account-data-platform/packages/db/src/publish-task-schema.ts`
- `account-data-platform/packages/db/src/migrations/*`
- `account-data-platform/packages/types/src/domain/publish-task.ts`
- `account-data-platform/apps/api/src/services/publish-scheduler.service.test.ts`

## 实施步骤

1. 定义 active publish 判定。
   - 新增 repository 函数，例如：
     - `hasActivePublishCommandForDevice(deviceId, excludeTaskId?)`
     - 或 `findActivePublishTaskForDevice(deviceId, excludeTaskId?)`
   - 判定范围建议包含：
     - `mobile_commands.commandType = "PUBLISH_VIDEO_TASK"`
     - `mobile_commands.status in ("PENDING", "FETCHED")`
     - 同设备、未删除、未过期
     - `publish_tasks.status in ("DISPATCHED", "RUNNING", "TOPIC_PENDING")`
   - `excludeTaskId` 必须支持，供话题补全重下发使用。

2. 增加 busy 重试字段。
   - 推荐在 `publish_tasks` 增加：
     - `failureCode` 或 `resultCode`
     - `dispatchRetryCount`
     - `nextDispatchAt`
     - `lastDispatchAttemptAt`
   - 如果不想新增状态枚举，可用：
     - `status = "PUBLISH_BUSY"` 表示等待后端重试
     - 或保留现有状态并用 `failureCode = "PUBLISH_BUSY" + nextDispatchAt` 表示等待。
   - 需要同步 schema、migration、类型和测试快照。

3. 在创建命令前检查 busy。
   - 修改 `dispatchMatchedPublishTask()`：
     - 匹配设备后，创建 `PUBLISH_VIDEO_TASK` 前先检查设备是否 busy。
     - busy 且未超过 3 次：
       - 不创建命令。
       - 记录 `PUBLISH_BUSY`。
       - `dispatchRetryCount += 1`。
       - `nextDispatchAt = now + 5 minutes`。
       - 不回写外部最终失败。
     - busy 且已超过 3 次：
       - 不创建命令。
       - 本地最终记录未发布。
       - 外部 PATCH `未发布`，错误 `PUBLISH_BUSY`。

4. 增加 due retry 调度。
   - 在 `runPublishSchedulerTick()` 或单独 worker 中扫描：
     - `failureCode/status = PUBLISH_BUSY`
     - `nextDispatchAt <= now`
     - 未超过最大重试次数
   - 重新调用同一 dispatch 逻辑。
   - 不能重新 claim 外部任务。

5. 与话题补全兼容。
   - `completePublishTaskTopics()` 调用重下发时，应传 `excludeTaskId = 当前任务 id`。
   - 如果当前任务已有旧命令，`redispatchPublishVideoTaskCommand()` 更新自身命令，不应被 busy 检查拦截。

6. 与移动端防御状态兼容。
   - 移动端已有本地锁失败上报 `PUBLISH_BUSY`，保留。
   - 后端接到移动端 `PUBLISH_BUSY` 时应按失败/未发布处理，或纳入相同失败码；但常规路径应由后端提前拦截，避免手机端收到第二条命令。

## 测试要求

在 `publish-scheduler.service.test.ts` 至少覆盖：

1. 同一设备已有 `PUBLISH_VIDEO_TASK/PENDING` 时，新任务不创建命令，进入 `PUBLISH_BUSY` 等待重试。
2. 同一设备已有 `PUBLISH_VIDEO_TASK/FETCHED` 时，新任务不创建命令。
3. busy 第 1 次记录 `nextDispatchAt = now + 5min`。
4. busy 第 2 次仍继续等待。
5. busy 第 3 次或超过最大次数后，最终回写外部 `未发布 + PUBLISH_BUSY`。
6. busy 等待期间不调用外部 PATCH 最终失败。
7. due retry 到期后能重新尝试下发。
8. 设备空闲后 retry 能成功创建命令。
9. 话题补全重下发排除当前任务，不被自身旧命令误判 busy。
10. 同一 slot 抖音先下发后，视频号命中同设备应进入 busy retry，不应立即创建第二条命令。

## 验收口径

- 同一设备不会同时存在两条待执行发布命令。
- 后端 busy 时不会把命令压到手机端队列。
- 默认重试策略为 3 次 / 每次 5 分钟。
- 重试耗尽后才回写外部 `PUBLISH_BUSY`。
- 看板能看到 busy 状态和下次重试时间。
- 手机端原有 `PUBLISH_BUSY` 防御测试继续通过。

## 风险提醒

- busy 检查和命令创建之间有并发窗口，最好放在同一事务或使用设备级锁。
- 如果只查 `mobile_commands`，但不查 `publish_tasks.DISPATCHED/RUNNING/TOPIC_PENDING`，可能漏掉执行中的任务。
- 如果把 `TOPIC_PENDING` 一律视为 busy，后台预检未下发的 topic pending 可能误占设备；需区分“手机端流程中 topic pending”和“后台 claim 后未下发 topic pending”。
- 如果 retry worker 重新 claim 外部任务，会制造重复任务，必须复用本地已保存任务。
