# Agent 断联安全收口设计

## 目标

当手机上的内部 Agent 在业务任务执行期间被本地“停止运行”按钮停止，外部 Agent 接管最后的界面清理和服务端回执，使旧任务立即释放、前端明确提示原因，并保证 Agent 再次启动后进入“无任务”状态。

## 范围与约束

- 保留 AutoJS + JavaScript 运行时，不引入 TypeScript、第三方依赖或新的编译规则到手机脚本。
- 不修改视频养号、直播互动、抓取评论词等业务流程脚本。
- 复用现有 `features/new-comment/cleanup.js` 与 `app/remote-wake-recents.js` 的安全退出动作。
- 内部 Agent 的强制停止动作保持不变；外部 Agent 只负责断联后的安全收口和回执。
- 底座网络心跳与 Agent 业务生命周期保持独立。
- 任务历史记录保留；清除的是运行态、设备占用和旧命令执行资格。

## 现有能力复用

`mobile-agent/autojs/features/new-comment/cleanup.js` 已实现最近任务清理、抖音卡片左滑、燎原星火卡片打开及包名启动兜底。`mobile-agent/autojs/app/remote-wake-recents.js` 已实现最近任务卡片识别、相对坐标左滑和结果校验。外部 Agent 负责调度一个独立清理执行入口并收集阶段结果，不复制手势识别逻辑。

## 生命周期模型

设备同时维护三个概念：

- `desiredAgentState`：服务端期望的 Agent 状态，仅表示控制意图。
- `agentLifecycleState`：手机实际 Agent 状态，取 `RUNNING`、`STOPPING`、`STOPPED`、`UNREACHABLE`。
- `pollingEnabled`：内部 Agent 是否允许领取业务命令。

本地停止事件携带 `reason=LOCAL_STOP_BUTTON`。Agent 启动成功后创建新的 `agentSessionId`，旧会话不具备领取命令的资格。

## 运行流程

### 本地停止

1. AutoJS launcher 写入本地停止标记，并通知外部 Agent。
2. 内部 Agent 继续执行现有的强制停止，停止 `main.js` 和 `watchdog.js`。
3. 外部 Agent 获得每设备唯一收口锁；已有收口执行时只复用其结果。

### 外部 Agent 收口

1. 确认设备此前存在未完成业务任务，或者断联事件携带有效任务身份。
2. 执行 `STOP_AGENT`、`EXIT_DOUYIN`、`OPEN_AGENT_HOME` 三个阶段。
3. 每个阶段记录开始时间、结束时间、结果和失败原因。
4. 阶段成功、部分失败或超时都必须产生最终回执；不允许无限重试。

### 服务端收口

服务端在一个事务中：

1. 保存 Agent 实际停止状态和停止原因。
2. 将设备所有未完成业务命令收敛为不可继续执行的终态，并记录 `AGENT_DISCONNECTED` / `LOCAL_STOP_BUTTON`。
3. 清除设备当前任务占用和运行身份。
4. 使旧 `PENDING`、`FETCHED`、`CLAIMED`、`RUNNING` 命令不能再次领取。
5. 重复回执只返回既有终态，不改变已完成收口结果。

即使界面清理失败，也必须完成任务收口；清理失败仅体现在回执和用户提示中。

### Agent 恢复

1. 外部 Agent 或本地“一键启动”启动内部 Agent。
2. 内部 Agent 上报新的 `agentSessionId`、`agentLifecycleState=RUNNING`、`pollingEnabled=true`。
3. 服务端恢复设备命令通道，但不恢复旧任务。
4. 前端清除活动批次的运行态，只显示“无任务”，启动按钮可用，停止按钮灰色。

## 回执契约

生命周期回执至少包含：

```json
{
  "agentLifecycleState": "STOPPED",
  "pollingEnabled": false,
  "reason": "LOCAL_STOP_BUTTON",
  "cleanupStatus": "SUCCESS",
  "taskResolution": "AGENT_DISCONNECTED",
  "cleanupStages": [
    { "name": "STOP_AGENT", "status": "SUCCESS" },
    { "name": "EXIT_DOUYIN", "status": "SUCCESS" },
    { "name": "OPEN_AGENT_HOME", "status": "SUCCESS" }
  ]
}
```

`cleanupStatus` 允许 `SUCCESS`、`PARTIAL`、`FAILED`。回执必须具有设备和事件幂等键，并支持网络中断后的外部 Agent 本地重试队列。

## 前端行为

设备 API 返回 Agent 实际生命周期、轮询开关、停止原因和清理结果。养号页面统一使用这些字段：

- Agent 停止且无任务：启动、停止均不可用，并提示 Agent 已停止。
- Agent 停止且有旧任务：旧任务显示“Agent 已断联，任务已通过外部 Agent 安全停止”，启动、停止均不可用。
- Agent 恢复且无任务：启动可用，停止不可用。
- 清理失败：显示失败阶段和人工处理提示，但旧任务仍为终态。

状态变化、页面首次检测到停止、用户选择设备和刷新后发现停止状态时，都要显示信息弹窗。设备状态刷新间隔保持在 2～3 秒范围内。

## 失败与竞态处理

- 外部收口动作按设备串行化，重复触发复用已保存结果。
- 收口期间服务端拒绝新业务命令；Agent 恢复后只接受新会话命令。
- 心跳超时是本地停止通知丢失时的兜底入口，不作为唯一入口。
- 外部 Agent 无网络时先保存回执，恢复网络后按幂等键补发。
- 清理总超时后仍完成服务端任务收口，避免任务永久停留在运行态。

## 验收场景

1. 无任务时本地停止和再次启动。
2. 视频养号、直播互动、抓取评论词执行中本地停止。
3. 外部清理全部成功、部分失败、完全失败和超时。
4. 重复停止事件、重复最终回执和网络恢复补发。
5. Agent 恢复后确认旧任务不复活、不占用设备、不影响新任务。
6. 前端弹窗、持续状态提示和按钮状态符合生命周期矩阵。

