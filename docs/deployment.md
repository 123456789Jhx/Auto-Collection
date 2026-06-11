# 部署说明

## 线上环境

- 服务器：`106.54.41.106`
- 线上后台：http://106.54.41.106:18080
- 移动端 API：http://106.54.41.106:18080/api/v1
- 健康检查：http://106.54.41.106:18080/ready
- 服务器部署目录：`/opt/auto-collection/account-data-platform`

## 生产服务

| 容器 | 说明 |
|---|---|
| `auto-collection-web` | Nginx 静态前端和反向代理 |
| `auto-collection-api` | Bun + Hono API |
| `auto-collection-postgres` | 项目内部 PostgreSQL |
| `auto-collection-redis` | 项目内部 Redis |

注意：公网 `5432` 当前对应其他项目数据库，不是 Auto Collection 的生产库。Auto Collection 的 PostgreSQL 在 Docker Compose 内部，不应直接用公网 5432 清理。

## 本地开发

```powershell
cd account-data-platform
bun install
bun run db:push
bun run dev
```

默认本地地址：

```text
API: http://localhost:3010
Web: http://localhost:3020
PostgreSQL: postgres://postgres:123456@localhost:5432/auto_collection
```

## 生产部署

在服务器执行：

```bash
cd /opt/auto-collection/account-data-platform
docker compose --env-file .env.production -f docker-compose.production.yml build api web
docker compose --env-file .env.production -f docker-compose.production.yml up -d
curl http://127.0.0.1:18080/ready
```

只更新 API：

```bash
cd /opt/auto-collection/account-data-platform
docker compose --env-file .env.production -f docker-compose.production.yml build api
docker compose --env-file .env.production -f docker-compose.production.yml up -d api
curl http://127.0.0.1:18080/ready
```

## 清理运行数据

仅清理设备、日志、采集记录、心跳、命令和版本事件等脏运行数据，保留 `collection_tasks` 任务配置：

```bash
cd /opt/auto-collection/account-data-platform
docker exec auto-collection-postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "truncate table agent_update_events, agent_versions, mobile_commands, device_task_configs, device_log_files, runtime_logs, device_heartbeats, collection_records, collector_devices cascade;"'
```

复查计数：

```bash
docker exec auto-collection-postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select '\''collector_devices'\'' as table_name, count(*) from collector_devices union all select '\''collection_records'\'', count(*) from collection_records union all select '\''device_heartbeats'\'', count(*) from device_heartbeats union all select '\''runtime_logs'\'', count(*) from runtime_logs union all select '\''device_log_files'\'', count(*) from device_log_files union all select '\''mobile_commands'\'', count(*) from mobile_commands union all select '\''agent_update_events'\'', count(*) from agent_update_events union all select '\''device_task_configs'\'', count(*) from device_task_configs union all select '\''agent_versions'\'', count(*) from agent_versions order by table_name;"'
```

## 移动端 APK 打包

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-autojs-apk.ps1
```

打包后安装到手机，打开应用检查无障碍、悬浮窗和脚本启动状态。新版手机端会生成并保存唯一设备 ID。
