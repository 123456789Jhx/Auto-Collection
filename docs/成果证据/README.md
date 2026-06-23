# 成果证据清单

项目：Auto Collection
负责人：张润

## README 成果入口

- 线上后台：http://106.54.41.106:18080
- 移动端 API：http://106.54.41.106:18080/api/v1
- 项目说明：`docs/当前入口/overview.md`
- 验收口径：`docs/当前入口/acceptance.md`
- 部署说明：`docs/当前入口/deployment.md`
- 方案设计：`docs/方案设计/README.md`
- 项目现状：`docs/项目记录/项目现状.md`
- 卡点和 Bug：`docs/项目记录/卡点与Bug记录.md`
- 开发排期：`docs/排期计划/development-plan.md`

## 已有证据

| 类型 | 路径或地址 | 说明 |
|---|---|---|
| 线上地址 | http://106.54.41.106:18080 | 生产后台入口 |
| 健康检查 | http://106.54.41.106:18080/ready | API、Postgres、Redis 状态 |
| 项目文档 | `docs/当前入口/overview.md` | 项目目标、成果、文档入口 |
| 验收文档 | `docs/当前入口/acceptance.md` | 功能和技术验收口径 |
| 部署文档 | `docs/当前入口/deployment.md` | 生产部署、清库、APK 打包 |
| 方案设计 | `docs/方案设计/README.md` | 架构方案、功能方案、后续方案索引 |
| 项目现状 | `docs/项目记录/项目现状.md` | 当前完成度和边界 |
| 卡点和 Bug | `docs/项目记录/卡点与Bug记录.md` | 当前问题、风险和回归清单 |
| 一周排期 | `docs/排期计划/development-plan.md` | 一周内功能拆解、每日计划、工时和风险 |
| 手机脚本文档 | `mobile-agent/autojs/README.md` | 手机端脚本说明 |
| 后台工程文档 | `account-data-platform/README.md` | 后台本地运行说明 |

## 待补证据

| 类型 | 推荐路径 | 要求 |
|---|---|---|
| 后台首页截图 | `docs/截图证据/dashboard.png` | 展示设备概览、日志入口或任务状态 |
| 设备页截图 | `docs/截图证据/devices.png` | 展示设备注册和在线状态 |
| 日志页截图 | `docs/截图证据/logs.png` | 展示按设备查看日志 |
| APK 页面截图 | `docs/截图证据/mobile-launcher.png` | 展示检查权限、启动脚本、停止脚本按钮 |
| 直播评论链路截图 | `docs/截图证据/live-comment-flow.png` | 展示后台下发、手机进入指定直播间、评论结果回传 |
| 演示录屏 | `docs/演示录屏/demo.mp4` | 展示手机端启动、后台出现设备、日志上报流程 |

## 证据规则

1. 截图必须来自真实页面，不使用 logo、icon 或占位图冒充功能截图。
2. 录屏应展示完整业务流程，不只录制静态页面。
3. 涉及账号、手机号、token、cookie、服务器密码的内容必须打码。
4. 截图和录屏统一放在 `docs/截图证据/`、`docs/演示录屏/`，不放项目根目录。
