# 手机 Agent 脚本 ZIP 自动更新实施方案

## 1. 文档目标

本文定义“燎原星火”手机 Agent 的脚本 ZIP 自动更新方案和实施验收标准。

目标是让 APK 只作为固定启动壳安装一次，后续业务脚本通过后台发布 ZIP 包自动更新。手机用户不需要重新安装 APK，不需要连接电脑，不需要手动导入脚本。

本方案只处理手机 Agent 脚本更新，不改变视频采集、直播互动、后台任务配置和设备控制的业务边界。

## 2. 背景与结论

当前手机端已经具备 APK 启动、无障碍与悬浮窗检查、后台心跳、版本检查和脚本运行能力。但旧流程存在两个问题：

1. 检查到新版本后只上报 `CHECKED`，没有完成下载、校验、替换和重启。
2. APK 内置脚本目录不可作为长期更新目录，后续应优先运行手机存储中的脚本目录。

实施结论：

1. APK 作为稳定启动壳，负责权限、启动器和脚本运行环境。
2. 业务脚本统一落到 `/sdcard/燎原星火/`。
3. 后台发布脚本 ZIP 包，手机主动检查版本并自动拉取。
4. 更新成功必须上报 `DOWNLOADED`、`VERIFIED`、`APPLIED`。
5. 更新失败必须保留旧版本继续运行，并上报 `FAILED`。

## 3. 变更范围

| 范围 | 说明 |
|---|---|
| 手机端启动器 | 优先读取 `/sdcard/燎原星火/`，外部目录不存在时再使用 APK 内置脚本 |
| 手机端更新器 | 下载 ZIP、校验 sha256、解压、覆盖脚本、重启入口 |
| 守护脚本 | 参与版本检查和失败后拉起主脚本 |
| 后台版本接口 | 返回最新 `PUBLISHED` 脚本版本 |
| 发布脚本 | 打包 ZIP、计算 sha256、上传服务器、发布版本记录 |
| 设备记录 | 展示当前版本、目标版本、更新状态和失败原因 |

## 4. 不变范围

1. 不改变 APK 包名和签名。
2. 不改变抖音采集和直播互动主流程。
3. 不做官方 API 接入。
4. 不做自动点赞、关注、私信等新增行为。
5. 不绕过验证码、登录异常或平台风控。
6. 不让中老年用户选择 ZIP 文件或操作脚本目录。

## 5. 目录模型

手机固定脚本目录：

```text
/sdcard/燎原星火/
```

目录结构：

```text
/sdcard/燎原星火/
  main.js
  main.module.js
  config.js
  watchdog.js
  app/
  core/
  domain/
  platforms/
  assets/
  datasource/
  .update/
```

目录规则：

1. `datasource/` 保存运行数据和采集缓存，更新时不得覆盖或删除。
2. `.update/` 保存下载包、临时解压目录、备份目录和更新锁。
3. APK 启动后优先查找 `/sdcard/燎原星火/project.json` 或入口文件。
4. 外部目录不存在时，使用 APK 内置脚本作为首次启动兜底。

## 6. 后台版本模型

后台维护脚本版本表 `agent_versions`。

| 字段 | 说明 |
|---|---|
| `version` | 脚本版本，例如 `0.1.21` |
| `channel` | 发布通道，例如 `stable`、`beta` |
| `packageUrl` | ZIP 下载地址 |
| `sha256` | ZIP 文件 SHA256 |
| `entryFile` | 入口文件，默认 `main.js` |
| `forceUpdate` | 是否强制更新 |
| `minSupportedVersion` | 最低可运行版本 |
| `status` | `DRAFT`、`PUBLISHED`、`DISABLED` |
| `releaseNote` | 发布说明 |
| `publishedAt` | 发布时间 |

后台只返回同通道下最新的 `PUBLISHED` 版本。

## 7. 手机端检查更新流程

手机端在以下时机检查版本：

1. App 启动后检查一次。
2. Agent 空闲循环中定时检查。
3. 守护脚本循环中定时检查。
4. 后台下发 `CHECK_UPDATE` 或 `UPDATE_AGENT` 指令时立即检查。

请求示例：

```http
GET /api/v1/mobile/agent-version?deviceId=device_xxx&currentVersion=0.1.20&channel=stable
```

返回示例：

```json
{
  "updateAvailable": true,
  "forceUpdate": false,
  "latestVersion": {
    "version": "0.1.21",
    "packageUrl": "http://106.54.41.106:18080/downloads/agent/liaoyuanxinghuo-autojs-0.1.21.zip",
    "sha256": "d65fde015a433b8045ef4586842c31ccb8d5f325b8e0ecd4d3617049805fcc4a",
    "entryFile": "main.js"
  }
}
```

## 8. 手机端应用更新流程

发现新版本后，手机端执行：

1. 写入更新锁，避免主脚本和守护脚本同时更新。
2. 上报 `CHECKED`。
3. 下载 ZIP 到 `/sdcard/燎原星火/.update/agent-版本号.zip`。
4. 上报 `DOWNLOADED`。
5. 计算本地 ZIP 的 SHA256，与后台返回值比对。
6. 上报 `VERIFIED`。
7. 解压到 `/sdcard/燎原星火/.update/stage-版本号/`。
8. 检查 `main.js`、`config.js`、`project.json` 等关键文件。
9. 备份当前脚本到 `/sdcard/燎原星火/.update/backup-旧版本/`。
10. 停止当前业务脚本。
11. 覆盖脚本文件到 `/sdcard/燎原星火/`。
12. 保留 `datasource/` 和 `.update/`。
13. 上报 `APPLIED`。
14. 重启 `main.js` 或等待守护脚本拉起。

## 9. 失败与回滚

失败场景：

| 场景 | 处理 |
|---|---|
| 下载失败 | 上报 `FAILED`，继续运行旧版本 |
| SHA256 不一致 | 删除下载包，上报 `FAILED`，继续运行旧版本 |
| ZIP 缺少入口文件 | 上报 `FAILED`，继续运行旧版本 |
| 覆盖中断 | 尝试恢复备份，上报 `FAILED` 或 `ROLLED_BACK` |
| 新版本启动失败 | 守护脚本恢复备份，上报 `ROLLED_BACK` |

备份策略：

1. 更新前备份当前脚本目录。
2. 只保留最近 2 个备份。
3. 不备份 `datasource/`，避免占用过多存储。

## 10. 更新锁

锁文件：

```text
/sdcard/燎原星火/.update/update.lock
```

规则：

1. 同一时间只允许一个更新任务。
2. 锁文件超过 10 分钟自动视为失效。
3. 更新完成、失败或回滚后必须删除锁。

## 11. 用户界面要求

中老年用户界面只保留必要操作：

1. 一键启动。
2. 停止运行。
3. 打开无障碍设置。
4. 打开悬浮窗设置。

状态文案：

| 状态 | 展示文案 |
|---|---|
| 正常待命 | `可以使用` |
| 正在运行 | `正在运行` |
| 权限缺失 | `需要授权` |
| 正在更新 | `正在更新，请稍候` |
| 更新完成 | `更新完成，正在重新启动` |
| 更新失败 | `更新失败，已继续使用旧版本` |

不向用户展示 ZIP、SHA256、脚本路径、ADB、导入文件等复杂概念。

## 12. 后台可观测性

后台设备列表需要展示：

1. 当前脚本版本。
2. 目标脚本版本。
3. 更新状态。
4. 最近更新时间。
5. 失败原因。

更新状态：

```text
CHECKED
DOWNLOADED
VERIFIED
APPLIED
FAILED
ROLLED_BACK
```

验收时必须以后台事件表和设备表为准，不只看手机页面。

## 13. 发布执行步骤

每次发布脚本版本按以下步骤执行：

1. 修改 `mobile-agent/autojs/config.js` 的 `app.version`。
2. 修改 `mobile-agent/autojs/project.json` 的 `versionName` 和 `versionCode`。
3. 执行 `scripts/package-autojs.ps1` 生成 ZIP。
4. 复制一份 ASCII 文件名 ZIP，避免中文 URL 兼容问题。
5. 上传 ZIP 和 `.sha256` 到服务器下载目录。
6. 调用后台发布脚本写入 `agent_versions`。
7. 用浏览器或 HTTP HEAD 验证 ZIP 可以公网下载。
8. 手机端触发更新。
9. 后台验证事件链完整。

## 14. 验收标准

真机验收必须满足：

1. 手机从旧版本检查到新版本。
2. 后台出现 `CHECKED`。
3. 后台出现 `DOWNLOADED`。
4. 后台出现 `VERIFIED`。
5. 后台出现 `APPLIED`。
6. 手机外部目录 `/sdcard/燎原星火/config.js` 版本号变为新版本。
7. 脚本重新启动后心跳中的 `appVersion` 变为新版本。
8. 更新过程中 `datasource/` 未丢失。
9. 更新失败时旧版本仍能继续运行。

未满足 `APPLIED` 和新版本心跳前，不能宣称自动更新通过。

## 15. 当前执行计划

第一步：完成文档和实现对齐。

第二步：把启动器改为优先读取 `/sdcard/燎原星火/`。

第三步：把下载、SHA256 校验、解压、覆盖、事件上报做成手机端公共更新能力。

第四步：发布 `0.1.21` 作为自动更新测试包。

第五步：ADB 恢复后执行真机验证，确认 `0.1.20 -> 0.1.21` 事件链。

## 16. 暂不处理内容

1. APK 自身静默升级。
2. 多渠道灰度规则页面。
3. 更新失败自动告警推送。
4. OTA 差分包。
5. HTTPS 证书与域名切换。
