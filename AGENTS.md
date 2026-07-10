# Repository Guidelines

## Project Structure & Module Organization

`account-data-platform/` 是 Bun 工作区：Hono API 位于 `apps/api/src/`，React 管理端位于 `apps/web/src/`，Drizzle schema 和 migration 位于 `packages/db/`，共享契约位于 `packages/types/`。`mobile-agent/autojs/` 保存 AutoX.js Android Agent，按 `app/`、`core/`、`domain/`、`platforms/` 和 `utils/` 分层，测试在 `tests/`。打包与部署入口在 `scripts/`，方案、项目记录和验收材料在 `docs/`。`dist/`、`tmp/` 和运行时数据属于本地产物，不要提交。

## Build, Test, and Development Commands

在 `account-data-platform/` 中运行：

- `bun install`：安装工作区依赖。
- `bun run db:push`：把 Drizzle schema 同步到本地数据库。
- `bun run dev`：同时启动工作区开发进程；也可用 `bun run dev:api` 或 `bun run dev:web`。
- `bun run lint`、`bun run typecheck`、`bun test`、`bun run build`：依次执行静态检查、类型检查、测试和生产构建。

从仓库根目录运行 `powershell -ExecutionPolicy Bypass -File .\scripts\package-autojs-apk.ps1` 构建 APK；需预先配置 JDK 21、Android SDK、AutoJs6 和签名信息。

## Coding Style & Naming Conventions

TypeScript 使用严格模式、两空格缩进、分号和双引号。React 组件与文件使用 PascalCase，例如 `DashboardPage.tsx`；变量和函数使用 camelCase；服务、仓储及 AutoX.js 文件通常使用 kebab-case。数据库字段使用 snake_case，枚举使用 UPPER_SNAKE_CASE。手机端保留现有 Auto.js/CommonJS 写法，不要直接套用 Web 端 ESLint 规则。

## Testing Guidelines

Bun 测试命名为 `*.test.ts` 或 `*.test.js`；API 测试与源码同目录，Web 测试位于 `apps/web/tests/`。手机端测试通过 `node mobile-agent/autojs/tests/control-loop.test.js` 等命令直接运行，并用 `node --check <file>` 检查非 UI 脚本语法。提交前先运行相关定向测试，再运行完整检查。仓库当前没有强制覆盖率阈值。

## Commit & Pull Request Guidelines

提交信息使用具体、结果导向的中文，例如 `修复任务调度暂停恢复`；`feat:`、`fix:`、`docs:` 前缀可选，避免 `update`、`fix bug` 等空泛描述。PR 应说明变更范围、验证命令和结果、相关项目记录；存在 Issue 时再关联。可见 UI 变更附真实页面截图或录屏。所有有效变更更新 `docs/项目开发/项目记录.md`；Bug 更新 `卡点与问题记录.md`，高风险链路审查更新 `代码审查风险记录.md`。

## Security & Configuration Tips

从 `account-data-platform/.env*.example` 创建本地配置，不提交真实 `.env`、密钥、Token、Cookie、账号或运行日志。真实互动功能必须具备明确开关、执行范围和审计记录。保留工作区中与当前任务无关的未提交改动。
