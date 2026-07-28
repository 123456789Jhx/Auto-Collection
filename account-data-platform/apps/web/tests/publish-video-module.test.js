import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const routesDir = path.join(webRoot, "src/routes");
const modulePath = path.join(routesDir, "PublishVideoModulePage.tsx");
const deviceListPath = path.join(routesDir, "DeviceList.tsx");
const bindingListPath = path.join(routesDir, "DeviceBindingList.tsx");
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
  assert(source.includes("开发中"));
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
