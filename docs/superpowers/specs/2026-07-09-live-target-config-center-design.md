# 直播目标配置中心设计

## 背景

当前“搜索直播评论”和“商品卡直播评论”都已有可运行链路，但配置分散在 JSON 中。用户确认采用独立表方案，不继续只靠 JSON 配置。目标是让后台可视化管理搜索词、直播间目标、别名、商品卡关键词和执行参数，并让手机端按结构化配置执行。

## 已确认决策

1. 采用方案 B：新增独立数据库表和接口。
2. 搜索词和目标直播间标准名分离。
3. 直播间名称匹配不要求 100% 一致。
4. 标准化后直播间候选名称与后台目标名或别名相似度 `>= 0.90` 即可进入。
5. 商品卡直播评论仍保持每轮扫描 15 分钟、命中观看 15 分钟、最多 3 轮、任意一轮没命中就结束。
6. 真实评论继续要求 `executeEnabled` 和 `manualExecutionApproved` 双开关。

## 设计范围

### 后端

新增四类对象：

| 对象 | 用途 |
|---|---|
| 直播目标 | 标准业务目标，例如“秭归夏橙直播间” |
| 目标别名 | 适配抖音直播卡片、主播名、商品卡标题等展示差异 |
| 功能配置 | 分别配置 `live_comment` 和 `commerce_card_live_comment` |
| 设备绑定 | 决定某台设备或默认任务使用哪些目标 |

### 前端

新增“直播目标配置”页面或在直播评论页增加配置中心入口。页面必须提供：

1. 目标直播间列表。
2. 别名管理。
3. 搜索直播评论配置。
4. 商品卡直播配置。
5. 设备绑定。
6. 命中日志查看。

### 手机端

手机端优先读取后端返回的 `liveTargets`。如果字段不存在，回退现有 `liveCommentBotConfig.targetRoom` 和 `commerceCardLiveComment` JSON。

## 数据模型

建议新增：

1. `live_targets`
2. `live_target_aliases`
3. `live_target_feature_configs`
4. `live_target_device_bindings`

关键字段以 `tenant_id`、`platform`、`target_code`、`feature_type`、`device_id` 作为主要查询维度。数组类配置可以用 JSONB，例如搜索词、商品词、直播信号和评论池；目标、别名和设备绑定必须独立成表。

## 匹配规则

### 标准化

进入相似度前执行：

1. 转小写。
2. 全角转半角。
3. 去空格、换行、标点和括号。
4. 去低价值后缀，例如“直播间”“直播”“官方”“旗舰店”。
5. 保留中文、英文、数字和核心商品词。

### 相似度

第一版使用 Levenshtein 相似度：

```text
similarity = 1 - editDistance(a, b) / max(length(a), length(b))
```

命中条件：

1. 从搜索结果卡片、用户块、商品卡、商品详情或进房页面提取候选名称。
2. 候选名称与 `targetName` 和所有 `aliasText` 分别比较。
3. 任一相似度 `>= 0.90` 即命中。
4. 命中禁入词时不进入或退出。
5. 短文本低于 4 个有效字符时，不用相似度，只允许别名精确或包含匹配。

## 执行流程

### 搜索直播评论

```text
读取 liveTargets(featureType=live_comment)
-> 按绑定优先级取目标
-> 按 searchKeywords 搜索
-> 扫直播卡片和用户块
-> 提取候选直播间名称
-> 相似度 >= 0.90
-> 进入直播间
-> 二次校验
-> 采样评论和执行评论策略
```

### 商品卡直播评论

```text
读取 liveTargets(featureType=commerce_card_live_comment)
-> 进商城搜索商品词
-> 每轮扫描商品卡 15 分钟
-> 商品词和直播信号命中
-> 直播目标名称相似度 >= 0.90
-> 进入直播间
-> 二次校验
-> 评论和观看 15 分钟
-> 最多 3 轮
-> 任意一轮未命中即结束
```

## 接口设计

后台接口挂在 `/api/v1/admin`：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/live-targets` | 目标列表 |
| `POST` | `/live-targets` | 新增目标 |
| `PATCH` | `/live-targets/:id` | 修改目标 |
| `DELETE` | `/live-targets/:id` | 软删除目标 |
| `GET` | `/live-targets/:id/aliases` | 别名列表 |
| `POST` | `/live-targets/:id/aliases` | 新增别名 |
| `PATCH` | `/live-target-aliases/:id` | 修改别名 |
| `DELETE` | `/live-target-aliases/:id` | 删除别名 |
| `GET` | `/live-targets/:id/feature-configs` | 功能配置 |
| `PATCH` | `/live-targets/:id/feature-configs/:featureType` | 保存功能配置 |
| `GET` | `/devices/:deviceCode/live-target-bindings` | 设备绑定 |
| `PATCH` | `/devices/:deviceCode/live-target-bindings` | 保存设备绑定 |

手机端配置接口在现有 `getCurrentTask` 结果上增加 `liveTargets`，兼容期保留旧字段。

## 迁移策略

1. 从 `liveCommentBotConfig.targetRoom` 生成默认直播目标、搜索词和别名。
2. 从 `p3ExtensionsConfig.commerceCardLiveComment` 生成商品卡功能配置。
3. 后台新页面保存新表。
4. 手机新版本优先读取 `liveTargets`。
5. 旧 JSON 保留一个 APK 版本周期作为兜底。

## 测试计划

1. 数据库 migration 和 schema 类型检查。
2. Admin API 增删改查测试。
3. `getCurrentTask` 聚合测试。
4. 相似度工具测试：全等、别名、90% 命中、低于阈值拒绝、短文本保护、禁入词。
5. 搜索直播评论 runner 测试：按搜索词搜索、按直播间名称相似度进入、进房后二次校验。
6. 商品卡 runner 测试：商品词、直播信号、目标名相似度、15/15/3 规则、未命中停止。
7. 后台页面表单测试：不再要求运营手填 JSON。

## 验收标准

1. 后台可以创建“秭归夏橙直播间”目标并配置别名。
2. 后台可以给同一目标配置搜索直播评论和商品卡直播评论。
3. 手机端收到 `liveTargets` 后按搜索词搜索，不直接强制搜目标名。
4. 直播卡片候选名称相似度 `>= 0.90` 时可进入。
5. 进入后必须二次校验，失败则退出并记录原因。
6. 商品卡任务保持既有 15 分钟扫描、15 分钟观看、最多 3 轮和未命中结束规则。
7. 所有命中、跳过、失败都有日志或动作审计。

## 不做事项

1. 不做 AI 语义匹配。
2. 不做外部 OCR 服务接入。
3. 不做购买、加购、关注、私信。
4. 不删除旧 JSON 字段。
5. 不改变任务调度 START、PAUSE、RESUME、STOP 协议。

## 后续实施顺序

1. 数据库和 migration。
2. Repository、service、admin API、类型定义。
3. `getCurrentTask` 聚合。
4. 后台配置页面。
5. 手机端 `liveTargets` 解析和相似度工具。
6. 搜索直播评论接入。
7. 商品卡直播评论接入。
8. 回归测试、项目记录、卡点和审查风险记录。
