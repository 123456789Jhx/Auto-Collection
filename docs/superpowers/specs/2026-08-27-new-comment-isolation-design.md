# 抓取评论词物理隔离与原子化设计

## 目标

在不修改旧评论抓取业务目录的前提下，为“抓取评论词”建立一套独立的新实现。新实现沿用现有前端输入、REST 命令通道、执行顺序、阶段日志、停止语义和结果结构，但把手机操作拆成可单独测试的基础动作，并通过唯一的新任务标识阻止错路由到视频发布或旧评论脚本。

## 已确认边界

- 采用方案 A：代码重新搭建，对外行为与当前抓取评论词功能保持一致。
- 新业务代码全部位于 `mobile-agent/autojs/features/new-comment/`。
- `mobile-agent/autojs/features/account-warmup/` 保持只读；新模块不得引用该目录。
- 新模块可以复用无障碍、OCR、日志、上传和线程等公共底层能力。
- 保留 REST 轮询，不引入 WebSocket，不修改 `mobile-agent/autojs/core/uploader.js`。
- 不修改现有 399 行的 `account-warmup-command-bridge.js`。
- 不以规避平台验证为目标；检测到验证时记录诊断信息并安全停止。
- 所有新增或修改的 JS/TS/TSX 文件不得超过 400 行。

## 路由设计

新实现使用内部功能标识 `isolated_live_comment_entry`，仍通过现有 `ACCOUNT_WARMUP_RUN` 命令下发。前端界面和用户输入不改变，只有内部任务标识发生变化。

新增 `features/new-comment/command-bridge.js`，并在 `main.module.js` 中先于旧养号桥接器安装：

1. 精确匹配 `ACCOUNT_WARMUP_RUN + isolated_live_comment_entry` 时由新桥接器消费。
2. 以 `isolated_` 开头但不符合白名单的任务直接失败并记录 `ROUTE_MISMATCH`。
3. 其他命令原样传给旧桥接器。
4. `ACCOUNT_WARMUP_STOP` 只有在 `targetCommandId + batchId` 同时匹配新任务时才由新桥接器消费，否则交给旧桥接器。
5. 新桥接器运行任务前检查旧桥接器的活动任务；新任务运行期间也拒绝新的旧养号任务，确保同一设备只有一个操作抖音的任务。

这样路由门禁和业务实现都位于新目录，旧评论 registry、旧入口和旧桥接器不需要改动。

## 新目录结构

```text
mobile-agent/autojs/features/new-comment/
├─ index.js                新业务唯一工厂入口
├─ contract.js             featureKey、阶段、状态和错误码
├─ command-bridge.js       路由、互斥、线程、进度、STOP 与回执
├─ workflow.js             搜索、进房、人数判断和总体流程编排
├─ comment-runner.js       评论分页、OCR 重试、停止和部分结果
├─ comment-capture.js      评论解析、过滤、去重和稳定 commentId
├─ gesture-actions.js      点击、双击和四向滑动原子动作
├─ screen-actions.js       等待、节点读取、截图和 OCR 原子动作
├─ douyin-layout.js        抖音选择器、坐标比例和 OCR 区域
├─ runtime.js              将公共底层能力适配为 workflow 所需接口
└─ cleanup.js              退出抖音并返回燎原星火
```

动作函数采用 AutoJS/CommonJS 同步模型。业务流程只能调用动作接口，不能直接使用 `click`、`swipe`、`text`、`desc`、截图或 OCR 原生 API。

## 等价行为

第一版必须保留下列现有行为：

- 输入参数仍为 `targetKeyword` 和 `minViewerCount`。
- 打开抖音后最多执行两次搜索。
- 切换直播页签并进入首个直播结果。
- 先判断直播结束，再读取观看人数；每个房间人数最多读取三次。
- 最多检查 20 个候选直播间，并在进入后最多确认三次页面状态。
- 评论首屏加最多五次上滑，共最多六页。
- 每页 OCR 最多三次；连续两个已翻页页面无新增评论时结束。
- 评论解析、过滤、跨页去重和稳定 commentId 与当前结果一致。
- 成功结果继续兼容 `LIVE_COMMENT_ENTRY_ENTERED`，并携带 `captureStatus=LIVE_COMMENT_ENTRY_CAPTURED`。
- 阶段历史最多保留 20 项。
- STOP 立即设置停止标记并中断工作线程，保留最近一次上报的部分评论，然后执行一次清理。

等价性通过同一组模拟输入分别运行旧实现与新实现，比对动作顺序、阶段、终态、评论结果和停止结果来证明。测试可以读取旧实现作为对照，但新生产代码不能引用旧实现。

## 原子动作约定

每个动作返回统一同步结果：

```js
{ success: true, value: optionalValue }
{ success: false, reason: "STABLE_REASON_CODE", message: "可读说明" }
```

- 点击支持节点或坐标，坐标随机偏移必须保持在目标边界内。
- 双击由两次受控点击组成，并在两次点击之间使用限定间隔。
- 滑动由方向和布局配置计算坐标，业务层不写死位置。
- 等待和 OCR 均有明确超时和有限重试，禁止无限循环。
- 每个耗时动作前后检查 `shouldStop()`。
- 平台验证检查发生在搜索、进房、OCR 和滑动的关键前后节点。

## 数据和结果

不改变现有 REST body 外层结构，也不新增数据库表。隔离信息通过现有扩展位置传递：

- 下行命令：`payload.featureKey = isolated_live_comment_entry`。
- 进度与终态：ACK 的 `result.featureKey` 保持同一值。
- 运行日志：日志 `context.featureKey` 保持同一值。
- STOP：沿用 `batchId + targetCommandId` 精确匹配。

旧 `live_comment_entry` 命令仍由旧桥接器处理，作为回退基线；新前端下发只生成新标识。

## 修改范围

允许修改：

- `mobile-agent/autojs/main.module.js`：加载并先安装新桥接器。
- `account-data-platform/packages/types/src/domain/account-warmup.ts`：新增严格的新 featureKey 分支。
- 抓取评论词前端的 form、batch、API client 和页面过滤：改用新 featureKey。
- 对应测试、项目记录、问题记录和风险记录。
- APK 版本和构建产物信息。

明确禁止修改：

- `mobile-agent/autojs/features/account-warmup/**`
- `mobile-agent/autojs/core/uploader.js`
- `mobile-agent/autojs/app/account-warmup-command-bridge.js`
- 养号、刷视频、发布视频和直播互动的业务实现。

## 验证策略

### 本地自动验证

- 依赖扫描：新生产代码不得 `require` 旧评论目录。
- 原子动作测试：点击边界、四向滑动、超时、停止和异常结果。
- 等价测试：动作顺序、阶段、结果、验证停止、OCR 重试和部分结果。
- 路由测试：合法新任务、非法 `isolated_*`、旧任务透传、空 featureKey。
- 生命周期测试：同设备互斥、重复命令幂等、STOP 匹配和 STOP 不误伤旧任务。
- 前端和共享契约测试。
- 旧养号、视频养号、评论入口和打包回归测试。

### APK 与真机验证

1. 固定包名 `com.agri.video.collector`，构建前校验现有签名证书指纹，禁止自动生成新证书。
2. 构建后验证签名、zipalign、ABI、版本和 SHA-256。
3. 安装前确认手机没有活动任务；只使用保留数据的覆盖安装，禁止自动卸载。
4. 安装后只读检查无障碍、悬浮窗和截图能力。
5. 无障碍未绑定时，先保留设备上其他无障碍服务，再尝试通过 ADB 恢复；若 MIUI 或截图授权要求人工确认，则停止并交由用户次日处理。
6. 通过后台抓取评论词页面输入测试关键词“药材种植”，选择一台测试设备下发。
7. 独立监控手机页面、Agent 日志和后台命令状态，确认执行新流程。
8. 依次验证正常任务、错路由拒绝、同设备忙碌拒绝、STOP 立即中断和平台验证安全停止。

真机测试不尝试绕过抖音验证，也不在用户未确认时自动卸载应用或清除应用数据。

