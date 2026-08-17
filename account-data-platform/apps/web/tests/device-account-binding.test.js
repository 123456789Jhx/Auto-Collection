import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const appRoute = fs.readFileSync(path.join(webRoot, "src/routes/App.tsx"), "utf8");
const publishVideoModule = fs.readFileSync(path.join(webRoot, "src/routes/PublishVideoModulePage.tsx"), "utf8");
const accountBindingControl = fs.readFileSync(
  path.join(webRoot, "src/routes/DeviceAccountBindingControl.tsx"),
  "utf8"
);
const deviceApiClient = fs.readFileSync(path.join(webRoot, "src/lib/api-client-devices.ts"), "utf8");
const deviceList = fs.readFileSync(path.join(webRoot, "src/routes/DeviceList.tsx"), "utf8");
const deviceBindingList = fs.readFileSync(path.join(webRoot, "src/routes/DeviceBindingList.tsx"), "utf8");

test("视频发布提供结构化账号绑定入口", () => {
  assert(publishVideoModule.includes("DeviceBindingList"));
  assert(appRoute.includes('key: "publishVideo"'));
  assert(!appRoute.includes('key: "devices"'));
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

test("视频发布绑定页显示匹配账号或未绑定", () => {
  assert(deviceList.includes("bindingStatus"));
  assert(deviceList.includes("抖音："));
  assert(deviceList.includes("视频号能力："));
  assert(deviceList.includes("未绑定"));
  assert(deviceList.includes("gray"));
  assert(deviceBindingList.includes("showBindingStatus"));
});

test("独立设备页已移除但发布账号绑定能力保留", () => {
  assert(!appRoute.includes("DevicesPage"));
  assert(publishVideoModule.includes('label: "设备账号"'));
  assert(deviceBindingList.includes("DeviceAccountBindingControl"));
});
