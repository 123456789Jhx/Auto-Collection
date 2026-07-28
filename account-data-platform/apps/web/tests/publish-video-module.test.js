import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const routesDir = path.join(webRoot, "src/routes");
const modulePath = path.join(routesDir, "PublishVideoModulePage.tsx");
const deviceListPath = path.join(routesDir, "DeviceList.tsx");
const bindingListPath = path.join(routesDir, "DeviceBindingList.tsx");
const operationsPath = path.join(routesDir, "PublishTaskOperations.tsx");
const manualModalPath = path.join(routesDir, "ManualPublishTestModal.tsx");
const publishApiPath = path.join(webRoot, "src/lib/api-client-publish-tasks.ts");
const appSource = fs.readFileSync(path.join(routesDir, "App.tsx"), "utf8");
const remoteSource = fs.readFileSync(path.join(routesDir, "RemoteScriptsPage.tsx"), "utf8");

test("视频发布模块组合四个业务标签", () => {
  assert(fs.existsSync(modulePath), "PublishVideoModulePage.tsx should exist");
  const source = fs.readFileSync(modulePath, "utf8");

  for (const label of ["任务看板", "任务操作", "业务配置", "设备绑定"]) {
    assert(source.includes(`label: "${label}"`), `missing ${label} tab`);
  }
  assert(source.includes("PublishTasksContent"));
  assert(source.includes('fixedScriptKey="publish_video"'));
  assert(source.includes("DeviceBindingList"));
  assert(source.includes("PublishTaskOperations"));
  assert(source.includes('activeKey={activeTab}'));
  assert(source.includes('setActiveTab("task-dashboard")'));
});

test("任务操作接通领取、立即调度和手动测试发布", () => {
  assert(fs.existsSync(operationsPath), "PublishTaskOperations.tsx should exist");
  assert(fs.existsSync(manualModalPath), "ManualPublishTestModal.tsx should exist");
  const operations = fs.readFileSync(operationsPath, "utf8");
  const modal = fs.readFileSync(manualModalPath, "utf8");
  const api = fs.readFileSync(publishApiPath, "utf8");

  for (const label of ["领取一条", "立即调度", "手动测试发布"]) {
    assert(operations.includes(label), `missing ${label} action`);
  }
  assert(operations.includes('scriptKey: "publish_video"'));
  assert(operations.includes('status: "ENABLED"'));
  assert(operations.includes("message.useMessage()"));
  assert(operations.includes("contextHolder"));
  assert(operations.includes("messageApi.success"));
  assert(operations.includes("messageApi.info"));
  assert(operations.includes("messageApi.error"));
  assert(operations.includes("coverUrl: values.coverUrl?.trim() || null"));

  for (const field of ["deviceId", "platform", "videoUrl", "coverUrl", "title", "description"]) {
    assert(modal.includes(`name="${field}"`), `missing ${field} field`);
  }
  assert(modal.includes("描述需含5个#话题"));
  assert(modal.includes("可留空"));
  assert(modal.includes("online"));
  assert(modal.includes('"running"'));

  assert(api.includes('"/admin/publish-tasks/claim-once"'));
  assert(api.includes('"/admin/publish-tasks/dispatch-now"'));
  assert(api.includes('"/admin/publish-tasks/manual-test"'));
});

test("视频发布菜单成为唯一发布入口并保留旧路由", () => {
  const menuItems = appSource.match(/items=\{\[([\s\S]*?)\]\}/)?.[1] ?? "";
  const orderedKeys = ["dashboard", "publishVideo", "devices", "records", "logs"];
  const positions = orderedKeys.map((key) => menuItems.indexOf(`key: "${key}"`));

  assert(positions.every((position) => position >= 0));
  assert(positions.every((position, index) => index === 0 || positions[index - 1] < position));
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
});

test("设备绑定主体复用设备列表并展示绑定状态", () => {
  assert(fs.existsSync(deviceListPath), "DeviceList.tsx should exist");
  assert(fs.existsSync(bindingListPath), "DeviceBindingList.tsx should exist");
  const deviceList = fs.readFileSync(deviceListPath, "utf8");
  const bindingList = fs.readFileSync(bindingListPath, "utf8");

  assert(deviceList.includes("renderActions"));
  assert(deviceList.includes("已绑定"));
  assert(deviceList.includes("未绑定"));
  assert(bindingList.includes("getDevices"));
  assert(bindingList.includes("DeviceList"));
  assert(bindingList.includes("DeviceAccountBindingControl"));
});
