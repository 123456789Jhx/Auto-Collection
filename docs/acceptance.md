# 验收口径

## 验收目标

负责人可以通过 GitHub 文档和线上后台判断当前成果是否可运行、可复查、可继续迭代。

## 功能验收

| 模块 | 验收口径 |
|---|---|
| 线上后台 | 打开 `http://106.54.41.106:18080` 能进入后台页面 |
| 设备列表 | 后台能展示已注册设备、在线状态、最近心跳和任务状态 |
| 日志页面 | 后台能按设备查看结构化日志和完整日志文件摘要 |
| 采集记录 | 后台能查看手机脚本上报的候选内容记录 |
| 移动端注册 | 新版 APK 首次启动后生成唯一设备 ID 并注册 |
| 设备认证 | 未注册设备访问普通移动端接口返回 401 |
| 旧版拦截 | 默认 `android_001` 注册返回 409，不再生成脏设备 |
| 数据清理 | 运行数据表清理后可通过 SQL 和后台 API 复查为空 |

## 技术验收

1. `bun --filter @app/api typecheck` 通过。
2. `bun --filter @app/api build` 通过。
3. 生产 Docker Compose 中 `auto-collection-api`、`auto-collection-web`、`auto-collection-postgres`、`auto-collection-redis` 正常运行。
4. `http://106.54.41.106:18080/ready` 返回 ready。

## 证据要求

1. README 提供线上地址、运行方式和验收口径。
2. `docs/overview.md` 提供项目目标、当前成果和阶段评分。
3. `docs/deployment.md` 提供生产部署和清理数据库说明。
4. `docs/evidence/README.md` 列出已有证据和待补证据。
5. 截图和录屏目前待补，后续放入 `docs/screenshots/` 和 `docs/recordings/`。

## 不通过条件

1. 旧版脚本请求后又自动创建设备。
2. 多台手机继续共用同一个 `android_001` 设备身份。
3. 日志、采集记录或心跳清理后仍有历史脏数据残留。
4. README 或 docs 无法说明项目目标、线上地址、运行方式和验收方式。
