import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const devicesPage = fs.readFileSync(path.join(webRoot, "src/routes/DevicesPage.tsx"), "utf8");
const appRoute = fs.readFileSync(path.join(webRoot, "src/routes/App.tsx"), "utf8");
const accountBindingControl = fs.readFileSync(
  path.join(webRoot, "src/routes/DeviceAccountBindingControl.tsx"),
  "utf8"
);
const deviceApiClient = fs.readFileSync(path.join(webRoot, "src/lib/api-client-devices.ts"), "utf8");
const deviceList = fs.readFileSync(path.join(webRoot, "src/routes/DeviceList.tsx"), "utf8");
const deviceBindingList = fs.readFileSync(path.join(webRoot, "src/routes/DeviceBindingList.tsx"), "utf8");

test("设备页提供结构化账号绑定入口", () => {
  assert(devicesPage.includes("DeviceAccountBindingControl"));
  assert(appRoute.includes('page === "devices"'));
  assert(appRoute.includes('key: "devices"'));
  assert(accountBindingControl.includes("抖音号 ID"));
  assert(accountBindingControl.includes("抖音账号名称"));
  assert(accountBindingControl.includes("微信视频号名称"));
  assert(accountBindingControl.includes("forceRender"));
  assert(!accountBindingControl.includes("destroyOnHidden"));
  assert(deviceApiClient.includes("{ accountProfile }"));
});

test("账号绑定开关支持清空并要求抖音账号名称", () => {
  assert(accountBindingControl.includes("绑定发布账号"));
  assert(accountBindingControl.includes("解除绑定后该设备将不再接收指定账号的发布任务"));
  assert(accountBindingControl.includes("Modal.useModal()"));
  assert(accountBindingControl.includes("bindingEnabled"));
  assert(accountBindingControl.includes("mutation.mutate({})"));
  assert(accountBindingControl.includes("required: true"));
  assert(accountBindingControl.includes("抖音账号名称"));
});

test("设备页和视频发布绑定页显示匹配账号或未绑定", () => {
  assert(deviceList.includes("bindingAccountName"));
  assert(deviceList.includes("未绑定"));
  assert(deviceList.includes("gray"));
  assert(devicesPage.includes("showBindingStatus"));
  assert(deviceBindingList.includes("showBindingStatus"));
});

test("LEGACY_FREEZE 设备页移除采集控制并保留绑定和维护命令", () => {
  for (const commandType of ["START", "PAUSE", "RESUME", "STOP"]) {
    assert(!new RegExp(`send(?:Command|MaintenanceCommand)\\([^)]*,\\s*["']${commandType}["']`).test(devicesPage));
  }
  assert(!devicesPage.includes("启动/继续"));
  assert(devicesPage.includes("DeviceAccountBindingControl"));
  assert(devicesPage.includes("REFRESH_CONFIG"));
  assert(devicesPage.includes("CHECK_UPDATE"));
  assert(devicesPage.includes("UPDATE_AGENT"));
  assert(devicesPage.includes("RESTART_APP"));
});
