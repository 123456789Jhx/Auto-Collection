import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const routesDir = path.join(webRoot, "src/routes");
const modulePath = path.join(routesDir, "PublishVideoModulePage.tsx");
const deviceListPath = path.join(routesDir, "DeviceList.tsx");
const bindingListPath = path.join(routesDir, "DeviceBindingList.tsx");
const bindingControlPath = path.join(routesDir, "DeviceAccountBindingControl.tsx");
const operationsPath = path.join(routesDir, "PublishTaskOperations.tsx");
const manualModalPath = path.join(routesDir, "ManualPublishTestModal.tsx");
const publishApiPath = path.join(webRoot, "src/lib/api-client-publish-tasks.ts");
const appSource = fs.readFileSync(path.join(routesDir, "App.tsx"), "utf8");
const remoteSource = fs.readFileSync(path.join(routesDir, "RemoteScriptsPage.tsx"), "utf8");
const remoteModalSource = fs.readFileSync(path.join(routesDir, "RemoteScriptConfigModal.tsx"), "utf8");
const schedulesPagePath = path.join(routesDir, "PublishSchedulesPage.tsx");

test("视频发布模块移除高级调试和日志排障入口", () => {
  assert(fs.existsSync(modulePath), "PublishVideoModulePage.tsx should exist");
  const source = fs.readFileSync(modulePath, "utf8");

  for (const label of ["任务看板", "粘贴发布", "接口定时", "发布设置", "设备账号"]) {
    assert(source.includes(`label: "${label}"`), `missing ${label} tab`);
  }
  for (const label of ["日志排障", "高级调试", "养号"]) {
    assert(!source.includes(`label: "${label}"`), `${label} tab should be removed`);
  }
  assert(source.includes("PublishTasksContent"));
  assert(source.includes("PublishPastePage"));
  assert(!source.includes("AccountWarmupPage"));
  assert(source.includes("PublishSchedulesPage"));
  assert(source.includes("PublishExecutionSettingsPage"));
  assert(source.includes("DeviceBindingList"));
  assert(!source.includes("PublishVideoLogTroubleshootingContent"));
  assert(!source.includes("PublishTaskOperations"));
  assert(!source.includes('key: "log-troubleshooting"'));
  assert(!source.includes('key: "advanced-debug"'));
  assert(!source.includes("LogsPage"));
  assert(source.includes('activeKey={activeTab}'));
  assert(source.includes('setActiveTab("task-dashboard")'));
});

test("高级调试禁用旧接口领取入口并保留本地任务直发和手动联调", () => {
  assert(fs.existsSync(operationsPath), "PublishTaskOperations.tsx should exist");
  assert(fs.existsSync(manualModalPath), "ManualPublishTestModal.tsx should exist");
  const operations = fs.readFileSync(operationsPath, "utf8");
  const modal = fs.readFileSync(manualModalPath, "utf8");
  const api = fs.readFileSync(publishApiPath, "utf8");

  for (const label of ["指定接口任务直发（单条）", "手动测试发布（联调工具）"]) {
    assert(operations.includes(label), `missing ${label} action`);
  }
  assert(!operations.includes("拉取一条接口任务（不下发）"));
  assert(!operations.includes("立即拉取接口任务并下发"));
  assert(operations.includes('sourceMode: "direct_material"'));
  assert(operations.includes("directConfigsQuery"));
  assert(operations.includes("请先到发布设置创建直接素材发布配置"));
  assert(operations.includes("dispatchExistingPublishTask"));
  assert(api.includes("dispatch-single"));
  assert(operations.includes("message.useMessage()"));
  assert(operations.includes("contextHolder"));
  assert(operations.includes("messageApi.success"));
  assert(operations.includes("messageApi.error"));
  assert(operations.includes("coverUrl: values.coverUrl.trim()"));
  assert(modal.includes('{ required: true, message: "请输入封面 URL" }'));
  assert(!modal.includes("可留空"));

  for (const field of ["deviceId", "platform", "videoUrl", "coverUrl", "title", "description"]) {
    assert(modal.includes(`name="${field}"`), `missing ${field} field`);
  }
  assert(modal.includes("validatePublishDescriptionTopics"));
  assert(modal.includes("expectedTopicCount"));
  assert(modal.includes("online"));
  assert(modal.includes('"running"'));

  assert(!api.includes('"/admin/publish-tasks/claim-once"'));
  assert(!api.includes('"/admin/publish-tasks/dispatch-now"'));
  assert(api.includes('"/admin/publish-tasks/manual-test"'));
});


test("设备绑定明确视频号字段仅用于能力检查", () => {
  const deviceList = fs.readFileSync(deviceListPath, "utf8");
  const bindingControl = fs.readFileSync(bindingControlPath, "utf8");

  assert(bindingControl.includes("用于确认该设备可发视频号"));
  assert(bindingControl.includes("不参与主路由"));
  assert(deviceList.includes("视频号能力："));
  assert(deviceList.includes("抖音："));
});


test("高级调试不挂载快速粘贴发布面板", () => {
  const operations = fs.readFileSync(operationsPath, "utf8");
  const modal = fs.readFileSync(manualModalPath, "utf8");

  assert(!operations.includes("QuickPastePublishPanel"));
  assert(!operations.includes("QuickPastePublishPreview"));
  assert(!modal.includes("快速粘贴发布"));
});

test("视频发布菜单成为唯一发布入口并保留旧路由", () => {
  const menuItems = appSource.match(/items=\{\[([\s\S]*?)\]\}/)?.[1] ?? "";
  const orderedKeys = ["publishVideo", "accountWarmup", "logs"];
  const positions = orderedKeys.map((key) => menuItems.indexOf(`key: "${key}"`));

  assert(positions.every((position) => position >= 0));
  assert(positions.every((position, index) => index === 0 || positions[index - 1] < position));
  assert(!menuItems.includes('key: "dashboard"'));
  assert(!menuItems.includes('key: "devices"'));
  assert(!menuItems.includes('key: "records"'));
  assert(!menuItems.includes('key: "publishTasks"'));
  assert(!menuItems.includes('key: "remoteScripts"'));
  assert(appSource.includes('window.location.pathname === "/publish-tasks"'));
  assert(appSource.includes('window.location.pathname === "/remote-scripts"'));
  assert(appSource.includes('window.location.pathname === "/publish-video"'));
  assert(appSource.includes('page === "publishTasks"'));
  assert(appSource.includes('page === "remoteScripts"'));
  assert(appSource.includes("TaskSchedulerPage"));
  assert(appSource.includes("TasksPage"));
});

test("业务配置固定过滤 publish_video 的列表和定义", () => {
  assert(remoteSource.includes("export function RemoteScriptsContent"));
  assert(remoteSource.includes("fixedScriptKey"));
  assert(remoteSource.includes("effectiveScriptKey"));
  assert(remoteSource.includes("item.scriptKey === fixedScriptKey"));
  assert(remoteModalSource.includes("normalizePublishVideoPayload"));
  assert(remoteModalSource.includes("delete normalized.dailyLimitPerAccount"));
  assert(remoteModalSource.includes("topicResolveTimeoutMinutes: 30"));
});

test("设备绑定主体复用设备列表并展示绑定状态", () => {
  assert(fs.existsSync(deviceListPath), "DeviceList.tsx should exist");
  assert(fs.existsSync(bindingListPath), "DeviceBindingList.tsx should exist");
  const deviceList = fs.readFileSync(deviceListPath, "utf8");
  const bindingList = fs.readFileSync(bindingListPath, "utf8");

  assert(deviceList.includes("renderActions"));
  assert(deviceList.includes("bindingStatus"));
  assert(deviceList.includes("未绑定"));
  assert(bindingList.includes("getDevices"));
  assert(bindingList.includes("DeviceList"));
  assert(bindingList.includes("DeviceAccountBindingControl"));
});
test("接口定时使用总任务运行控制、匹配设备和运行监控", () => {
  const schedules = fs.readFileSync(schedulesPagePath, "utf8");

  assert(!schedules.includes("RemoteScriptsContent"));
  assert(!schedules.includes("新建远程脚本配置"));
  assert(!schedules.includes("Token 环境变量名"));
  assert(schedules.includes("固定接口连接"));
  assert(schedules.includes("测试连接"));
  assert(schedules.includes("固定接口配置尚未初始化"));
  assert(schedules.includes("InterfacePublishRunControl"));
  assert(schedules.includes("InterfacePublishBindingsPanel"));
  assert(schedules.includes("InterfacePublishRunMonitor"));
  assert(!schedules.includes("Fixed device publish plans"));
  assert(!schedules.includes('name="platforms"'));
  assert(!schedules.includes('name="timeWindows"'));
  assert(!schedules.includes('dataIndex: "publishTimeSlots"'));
  assert(!schedules.includes("立即拉取并下发"));
});
