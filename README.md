# Auto Collection

农业内容采集脚本与设备监控后台，用于小范围 Android 设备运行 AutoX.js 采集脚本，并在后台查看设备状态、采集记录、心跳、日志和远程控制结果。

## 项目目标

本项目解决手机端自动化脚本运行过程不可见、日志分散、设备状态难排查的问题。当前阶段重点是把 2-3 台测试手机的运行数据集中到轻量后台，方便判断脚本是否正常运行、农业关键词命中是否稳定、异常停止原因是否可追踪。

## 业务价值

- 降低人工查看手机和翻本地日志的成本。
- 通过后台统一查看设备在线状态、运行进度、采集记录和错误日志。
- 支持小范围 APK 试运行，便于快速发现脚本、权限、版本和设备认证问题。

## 项目信息

- 负责人：张润
- 技术负责人：张润
- 项目状态：测试中
- 开发周期：2026-06-01 至 2026-06-11
- 线上地址：http://106.54.41.106:18080
- 移动端 API：http://106.54.41.106:18080/api/v1

## 成果入口

- 线上后台：http://106.54.41.106:18080
- 项目说明：[docs/overview.md](docs/overview.md)
- 验收口径：[docs/acceptance.md](docs/acceptance.md)
- 部署说明：[docs/deployment.md](docs/deployment.md)
- 开发排期：[docs/schedules/development-plan.md](docs/schedules/development-plan.md)
- 成果证据清单：[docs/evidence/README.md](docs/evidence/README.md)
- 手机端说明：[mobile-agent/autojs/README.md](mobile-agent/autojs/README.md)
- 后台工程说明：[account-data-platform/README.md](account-data-platform/README.md)

## 目录结构

```text
mobile-agent/            手机端 AutoX.js 脚本与 APK 打包工程
account-data-platform/   Bun + Hono + React + PostgreSQL 监控后台
scripts/                 打包和辅助脚本
docs/                    需求、方案、验收、排期、证据和项目记录
```

## 运行方式

后台本地开发：

```powershell
cd account-data-platform
bun install
bun run db:push
bun run dev
```

手机端 APK 打包：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-autojs-apk.ps1
```

生产部署参考：[docs/deployment.md](docs/deployment.md)。

## 验收口径

- 负责人能打开线上后台查看设备、采集记录、日志和任务配置页面。
- 新版 APK 首次启动后能使用唯一设备 ID 注册，不再出现多台手机共用 `android_001` 的脏数据。
- 旧版脚本或未注册设备请求后台时被拒绝，不再自动创建设备。
- 后台数据库中的日志、采集记录、心跳、命令和设备信息可以按需清理并复查为 0。
- 本地和生产 API 构建通过。

## 本期成果

- 完成手机脚本、后台 API、后台 Web、Docker 生产部署结构。
- 完成设备心跳、运行日志、采集记录、日志文件上传和后台展示。
- 修复设备认证和注册逻辑，避免普通上报接口自动创建脏设备。
- 完成生产库脏数据清理，并部署服务端拒绝旧版 `android_001` 注册的保护逻辑。

## 阶段评分

- 目标定义：85
- 调研和需求拆解：78
- 开发实施：82
- 联调验证：75
- 线上部署：80
- 验收材料：65
- 截图和录屏证据：20
- 商业化沉淀：40
