# Account Data Platform

Auto Collection 的后台监控工程，用于接收手机端脚本上报的设备注册、心跳、运行日志、完整日志文件和采集记录，并提供 Web 管理页面。

## 工程结构

```text
apps/api       Bun + Hono 后台 API
apps/web       React 19 + Vite + Ant Design 管理后台
packages/db    Drizzle ORM schema、迁移和数据库客户端
packages/types 前后端共享类型和 Zod schema
deploy/        Dockerfile、Nginx 和生产部署说明
```

## 本地环境

默认本机服务：

```text
PostgreSQL: postgres / 123456 / localhost:5432 / auto_collection
Redis: 123456 / localhost:6379
API: http://localhost:3012
Web: http://localhost:3022
Mobile API: http://192.168.7.170:3012/api/v1
```

启动：

```bash
bun install
bun run db:push
bun run dev
```

如果 `auto_collection` 数据库不存在，需要先在 PostgreSQL 中创建。

## 常用命令

```bash
bun --filter @app/api typecheck
bun --filter @app/api build
bun --filter @app/web build
bun run db:push
```

## 生产部署

生产部署使用 Docker Compose，入口在仓库根目录的 [docs/deployment.md](../docs/deployment.md) 和本目录的 [deploy/README.md](deploy/README.md)。

线上地址：

```text
Web: 待部署后回填
API: 待部署后回填
Health: 待部署后回填
```

## 设备认证规则

1. 手机端必须先调用 `/mobile/device-token/register` 注册设备 token。
2. 普通移动端接口必须携带 `deviceId` 和 `X-Device-Token`。
3. 未注册或 token 不匹配的设备返回 401，不自动创建设备。
4. 默认 `android_001` 或 `unknown` 不能作为正式设备 ID 注册。
