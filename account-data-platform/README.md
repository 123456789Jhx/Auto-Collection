# Account Data Platform

账号数据管理平台，用于接收手机采集脚本上报的运行数据、采集记录、心跳和日志，并提供设备、任务、采集数据、日志的管理页面。

当前阶段包含：

1. `apps/api`：Bun runtime + Hono 后端 API。
2. `apps/web`：React 19 + Vite + Ant Design 后台管理端。
3. `packages/db`：Drizzle ORM schema、migration 和数据库客户端。
4. `packages/types`：前后端共享类型和 Zod schema。

## 本地环境

默认本机服务：

```text
PostgreSQL: postgres / 123456 / localhost:5432
Redis: 123456 / localhost:6379
API: http://localhost:3010
Web: http://localhost:3020
```

启动：

```bash
cd account-data-platform
bun install
bun run db:generate
bun run db:push
bun run dev
```

如果 `auto_collection` 数据库不存在，需要先创建数据库。
