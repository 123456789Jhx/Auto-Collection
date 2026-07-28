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

test("设备页提供结构化账号绑定入口", () => {
  assert(devicesPage.includes("DeviceAccountBindingControl"));
  assert(appRoute.includes('page === "devices"'));
  assert(appRoute.includes('key: "devices"'));
  assert(accountBindingControl.includes("抖音号 ID"));
  assert(accountBindingControl.includes("抖音号名称"));
  assert(accountBindingControl.includes("微信视频号名称"));
  assert(accountBindingControl.includes("forceRender"));
  assert(!accountBindingControl.includes("destroyOnHidden"));
  assert(deviceApiClient.includes("{ accountProfile }"));
});
