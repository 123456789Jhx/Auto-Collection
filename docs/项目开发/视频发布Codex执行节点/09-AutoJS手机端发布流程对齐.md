# 09-AutoJS 手机端发布流程对齐

## 目标

核对并小范围补齐 AutoJS 手机端发布执行器，使其与后端新规则一致。

手机端职责保持为：

- 只执行单条 `PUBLISH_VIDEO_TASK`。
- 本地发布锁只做最后防御，不承担后台排队。
- 逐条下载素材、逐条发布、逐条清理。
- 抖音和视频号按 payload 平台分支执行。
- 话题不足时支持断点补全。
- 视频号验证弹窗只标记上报，不继续操作。

## 当前状态

前序只读核对发现，手机端已有较完整实现：

- `publish-video-entry.js`
  - 共享入口处理 `PUBLISH_VIDEO_TASK`。
  - 获取发布锁。
  - 话题预检。
  - 平台分流。
  - 结果上报和 ACK。
  - finally 清理素材目录并释放锁。

- `material-dir-manager.js`
  - 每任务创建日期目录。
  - 下载视频和封面。
  - 写入后媒体扫描。
  - 发布后删除本次目录。

- `publish-task-lock.js`
  - 15 分钟 TTL 本地发布锁。
  - 锁忙时返回 `PUBLISH_BUSY`。

- 抖音流程：
  - 打开相机/发布页。
  - 前两项相册素材判断。
  - 封面编辑。
  - 标题描述话题填写。
  - 发布成功判定。

- 视频号流程：
  - 微信启动校正。
  - 发现 → 视频号 → 我的 → 发表视频。
  - 素材选择、标题、导出、描述话题、发表。
  - 验证弹窗强特征检测并上报 `CHANNELS_VERIFY_PENDING`。

- 话题断点：
  - 收到命令时话题不足，不下载、不开 app，上报 `TOPIC_PENDING`。
  - 流程中话题未选中，保持当前流程轮询补全后继续。

## 当前问题 / 需补齐点

1. 后端将承担同设备 busy retry，手机端无需实现 3 次 / 5 分钟重试。
2. 手机端仍要保留本地 `PUBLISH_BUSY` 防御，避免后端漏判或并发命令到达。
3. 视频号分支必须始终从共享入口进入，不能绕过素材清理和发布锁。
4. 视频号验证弹窗上报后应 ACK `DONE`，并带 `popupFeature`，不继续点击。
5. 成功/失败判定仍需要真机校准；代码已有启发式判断，但不要过度扩展。
6. 封面必填由后端保证，手机端下载器仍保留缺封面 `MATERIAL_INVALID` 防御即可。

## 不要改什么

- 不要在手机端实现后台延迟重试。
- 不要让手机端轮询多条发布命令后自行排队。
- 不要把一条命令改成内部双平台串行发布。
- 不要绕过 `publish-video-entry.js` 直接调用 `channels-publish-flow.js`。
- 不要在视频号验证弹窗出现后继续输入或点击。
- 不要删除素材目录白名单保护逻辑，避免误删用户文件。
- 不要大改 AutoJS 文件结构；保持单文件小于 400 行，必要时拆新 domain/feature 文件。

## 涉及文件

- `mobile-agent/autojs/features/publish-video/publish-video-entry.js`
- `mobile-agent/autojs/features/publish-video/channels-publish-flow.js`
- `mobile-agent/autojs/features/publish-video/channels-publish-ui.js`
- `mobile-agent/autojs/features/publish-video/channels-verify-popup.js`
- `mobile-agent/autojs/features/publish-video/douyin-publish-ui.js`
- `mobile-agent/autojs/features/publish-video/select-publish-material.js`
- `mobile-agent/autojs/features/publish-video/edit-cover.js`
- `mobile-agent/autojs/features/publish-video/fill-publish-text.js`
- `mobile-agent/autojs/features/publish-video/execute-publish.js`
- `mobile-agent/autojs/domain/material-dir-manager.js`
- `mobile-agent/autojs/domain/material-inspector.js`
- `mobile-agent/autojs/domain/publish-task-lock.js`
- `mobile-agent/autojs/domain/action-timing-gates.js`
- `mobile-agent/autojs/domain/topic-validator.js`
- `mobile-agent/autojs/domain/topic-resume.js`
- `mobile-agent/autojs/domain/publish-watchdog.js`
- `mobile-agent/autojs/app/publish-video-preloader.js`
- `mobile-agent/autojs/app/control-loop.js`

## 实施步骤

1. 先补测试，不先改逻辑。
   - 重点确认现有共享入口语义：
     - 视频号任务从共享入口分流。
     - 视频号分支执行后共享入口 finally 清理素材并释放锁。
     - 视频号分支不会单独持锁。

2. 保留本地锁忙语义。
   - `publish-video-entry.js` 中锁获取失败仍返回并上报 `PUBLISH_BUSY`。
   - ACK 状态保持现有测试期望，按后端最终口径决定是 `FAILED` 还是 `DONE`。
   - 但常规情况下后端不应再下发第二条命令。

3. 视频号共享入口约束。
   - 确认 `control-loop.js` 只分发到 `publish-video-entry.js`。
   - 不新增直接调用 `channels-publish-flow.js` 的控制命令。
   - `channels-publish-flow.js` 保持依赖共享入口传入的 `materialDownloader` 和 `resultReporter`。

4. 素材清理测试。
   - 对视频号任务模拟下载成功后流程失败，断言：
     - `materialManager.endTask(activeMaterialDir)` 被调用。
     - `publishLock.release()` 被调用。
   - 对视频号验证弹窗，也要断言清理和 release。

5. 话题断点测试保持。
   - 抖音流程已测：流程中 `TOPIC_PENDING` → poll → 继续发布。
   - 如视频号也支持流程中 topic continuation，补一条视频号对应测试。

6. 预加载清单同步。
   - 如果新增任何手机端模块，更新 `publish-video-preloader.js` 的 `modulePaths`。
   - 更新 `control-loop.test.js` 中 expected preload paths。
   - 确保 worker 处理命令时只用缓存，不再运行时加载缺失模块。

7. 成功判定只做真机校准小修。
   - 抖音 `waitForPublishSuccess()` 和视频号 `waitForPublishOutcome()` 目前是启发式。
   - 真机发现具体文本或页面特征后，只补强特征，不做大范围 OCR 重构。

## 测试要求

手机端测试：

- `mobile-agent/autojs/tests/publish-video-flow.test.js`
  - 抖音成功链路继续通过。
  - `PUBLISH_BUSY` 防御继续通过。
  - 素材下载失败清理目录并释放锁。
  - 新增：视频号分支经共享入口后也清理目录并释放锁。

- `mobile-agent/autojs/tests/publish-video-channels.test.js`
  - 视频号成功链路继续通过。
  - 验证弹窗命中后 `CHANNELS_VERIFY_PENDING`。
  - 验证弹窗后不继续输入或点击。
  - 新增：验证弹窗也触发共享入口 finally 清理。

- `mobile-agent/autojs/tests/publish-topic-continuation.test.js`
  - 收到命令时话题不足不下载不开 app。
  - 流程中话题待补，轮询补全后继续。
  - 超时失败并清理释放锁。

- `mobile-agent/autojs/tests/publish-video-preloader.test.js`
  - 新增模块时更新预加载清单。

- `mobile-agent/autojs/tests/control-loop.test.js`
  - `PUBLISH_VIDEO_TASK` 仍只从预加载 handler 分发。

## 验收口径

- 手机端不会承担后端 busy retry。
- 手机端仍能防御性上报本地 `PUBLISH_BUSY`。
- 抖音和视频号都从共享入口走统一锁、下载、上报、ACK、清理。
- 视频号验证弹窗只标记上报，不继续动作。
- 话题补全可在当前流程中继续。
- 所有发布相关 AutoJS 定向测试通过。

## 风险提醒

- 如果把视频号 handler 直接暴露给控制循环，会绕过共享入口 cleanup。
- 如果新增模块但忘记加到 preloader，真机热更新/打包环境可能运行时找不到模块。
- 如果手机端也实现 3 次 / 5 分钟 retry，会和后端 retry 叠加，导致重复发布或延迟不可控。
- 如果删除无封面跳过逻辑，旧 payload 可能直接崩；后端强制封面后，该逻辑可以作为兼容防御保留。
