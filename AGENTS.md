# Repository Guidelines

## Project Structure \& Module Organization

`account-data-platform/` 是 Bun 工作区：Hono API 位于 `apps/api/src/`，React 管理端位于 `apps/web/src/`，Drizzle schema 和 migration 位于 `packages/db/`，共享契约位于 `packages/types/`。`mobile-agent/autojs/` 保存 AutoX.js Android Agent，按 `app/`、`core/`、`domain/`、`platforms/` 和 `utils/` 分层，测试在 `tests/`。打包与部署入口在 `scripts/`，方案、项目记录和验收材料在 `docs/`。`dist/`、`tmp/` 和运行时数据属于本地产物，不要提交。

## Build, Test, and Development Commands

在 `account-data-platform/` 中运行：

* `bun install`：安装工作区依赖。
* `bun run db:push`：把 Drizzle schema 同步到本地数据库。
* `bun run dev`：同时启动工作区开发进程；也可用 `bun run dev:api` 或 `bun run dev:web`。
* `bun run lint`、`bun run typecheck`、`bun test`、`bun run build`：依次执行静态检查、类型检查、测试和生产构建。

从仓库根目录运行 `powershell -ExecutionPolicy Bypass -File .\\\\scripts\\\\package-autojs-apk.ps1` 构建 APK；需预先配置 JDK 21、Android SDK、AutoJs6 和签名信息。

## Coding Style \& Naming Conventions

TypeScript 使用严格模式、两空格缩进、分号和双引号。React 组件与文件使用 PascalCase，例如 `DashboardPage.tsx`；变量和函数使用 camelCase；服务、仓储及 AutoX.js 文件通常使用 kebab-case。数据库字段使用 snake\_case，枚举使用 UPPER\_SNAKE\_CASE。手机端保留现有 Auto.js/CommonJS 写法，不要直接套用 Web 端 ESLint 规则。

## 多对话联合打包规则

- 本项目由三个对话共同开发：`群控02`（`01a06f57-9775-7fc2-b68c-51eff0f2930c`）、`群控03-直播互动养号`（`01a06f59-872b-7860-b075-404cfc1a36fb`）、`群控04-刷视频`（`01a0857a-f7f3-7470-9eb2-69db1d9b0171`）。各自可以开发和执行不影响共享打包现场的测试，不得各自改完就直接打包。
- 每次准备打 APK，必须先读取 `docs/项目开发/联合打包台账.md`，联系另外两个对话，汇总修改文件、功能变化、完成情况、验证结果、共享文件冲突、基座与业务脚本依赖，以及本批次纳入或排除的内容。没有回复不代表同意；规则已知悉不代表批准任何具体批次。
- 三方针对同一份输入清单明确确认后，在台账登记本批次唯一打包执行者和固定输入快照。未完成或冲突内容不能直接混入；不能为了排除内容删除、还原他人的工作区改动。
- 打包执行者独占本批次打包暂存区和输出目录。其他对话不得并行打包、重写打包暂存区，或运行会改写暂存区的 `-SkipBuild`、构建配置测试等操作。打包从已确认的固定输入执行；输入变化必须重新确认，不能悄悄带入同一批次。
- 执行者统一运行必要回归，检查 APK 内脚本与确认输入的校验值、APK 与业务脚本版本/兼容关系、旧热更新覆盖风险，再将产物路径、Build ID、SHA256、测试结果和未验收项写回台账并通知另外两个对话。不能用安装成功替代实际加载脚本验证。
- 打包协商不等于授权安装设备、重启任务或发布远程业务包。上述操作仍按用户授权范围单独确认；不得将统一打包变成面向所有设备的自动发布。

## Testing Guidelines

Bun 测试命名为 `\\\*.test.ts` 或 `\\\*.test.js`；API 测试与源码同目录，Web 测试位于 `apps/web/tests/`。手机端测试通过 `node mobile-agent/autojs/tests/control-loop.test.js` 等命令直接运行，并用 `node --check <file>` 检查非 UI 脚本语法。提交前先运行相关定向测试，再运行完整检查。仓库当前没有强制覆盖率阈值。

## Commit \& Pull Request Guidelines

提交信息使用具体、结果导向的中文，例如 `修复任务调度暂停恢复`；`feat:`、`fix:`、`docs:` 前缀可选，避免 `update`、`fix bug` 等空泛描述。PR 应说明变更范围、验证命令和结果、相关项目记录；存在 Issue 时再关联。可见 UI 变更附真实页面截图或录屏。所有有效变更更新 `docs/项目开发/项目记录.md`；Bug 更新 `卡点与问题记录.md`，高风险链路审查更新 `代码审查风险记录.md`。

## Security \& Configuration Tips

从 `account-data-platform/.env\\\*.example` 创建本地配置，不提交真实 `.env`、密钥、Token、Cookie、账号或运行日志。真实互动功能必须具备明确开关、执行范围和审计记录。保留工作区中与当前任务无关的未提交改动。

## 本机 ADB 联调

- 本 Windows 主机在 2026-09-06 核实存在 5037/5038 两个 ADB 服务：默认 5037 的设备列表为空，5038 可连接授权设备。先在主机终端执行 `& 'D:\DevTools\Android\Sdk\platform-tools\adb.exe' -P 5038 devices -l`，再根据本次返回的序列号用 `-P 5038 -s <serial>` 执行命令；不要仅凭默认 `adb devices` 为空就判定手机断开。
- 用户环境已保存 `ADB_SERVER_SOCKET=tcp:127.0.0.1:5038`，但已运行的 Codex/终端进程可能仍继承旧环境。显式 `-P 5038` 不依赖环境刷新；也可执行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-apk-usb.ps1 -CheckOnly`，该入口会读取用户配置且不要求 APK、不安装应用。
- 浏览器沙盒中的命令不能代替 Windows 主机 ADB 检测。若当前任务没有主机终端能力，应说明工具环境限制，不据此要求用户反复插拔手机。不要为解决默认端口空列表停止正在使用的群控或 ADB 服务。

## 远程脚本模块硬性约束



\- 每个新建或修改的 .js/.ts/.tsx 源文件**硬上限 600 行（严禁突破）**，并**尽量保持在 450 行以内**。适用于本模块新建或修改的文件；存量超限文件不在节点内重构，发现后记入 docs/项目开发/卡点与问题记录.md 另行立项



\- 远程脚本模块的实施以 docs/方案设计/功能方案/远程脚本功能模块方案.md 为唯一设计依据

\- 每个节点完成后必须更新 docs/项目开发/远程脚本模块/进度台账.md 与 docs/项目开发/项目记录.md
