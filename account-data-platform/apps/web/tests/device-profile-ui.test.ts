import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");

test("device binding list exposes a per-device profile action", () => {
  const list = fs.readFileSync(path.join(webRoot, "src/routes/DeviceList.tsx"), "utf8");
  const binding = fs.readFileSync(path.join(webRoot, "src/routes/DeviceBindingList.tsx"), "utf8");
  assert.match(list, /DeviceProfileModal/);
  assert.match(list, /setProfileDevice\(device\)/);
  assert.match(list, /编辑该设备的机型画像覆盖/);
  assert.match(binding, /title="设备绑定清单"/);
});

test("profile editor exposes reversible Xiaomi 14 preview and refresh delivery", () => {
  const modal = fs.readFileSync(path.join(webRoot, "src/components/device-profile/DeviceProfileModal.tsx"), "utf8");
  const model = fs.readFileSync(path.join(webRoot, "src/lib/device-profile-form.ts"), "utf8");
  assert.match(modal, /设备画像已保存，设置已同步到手机/);
  assert.match(modal, /恢复默认设置/);
  assert.match(modal, /已自定义/);
  assert.match(modal, /使用默认方案/);
  assert.match(modal, /paths\.length \? "已合并" : "未覆盖"/);
  assert.match(model, /key: "xiaomi_14"/);
  assert.match(model, /foregroundWaitMs: 1200/);
  assert.match(model, /outputRoots: \[\]/);
});

test("profile editor defaults to a plain-language view with advanced details collapsed", () => {
  const modal = fs.readFileSync(path.join(webRoot, "src/components/device-profile/DeviceProfileModal.tsx"), "utf8");
  assert.match(modal, /设备概览/);
  assert.match(modal, /高级配置/);
  assert.match(modal, /<details/);
  assert.match(modal, /秒/);
  assert.match(modal, /当前使用/);
});

test("device account list exposes a friendly search and status filter", () => {
  const list = fs.readFileSync(path.join(webRoot, "src/routes/DeviceList.tsx"), "utf8");
  assert.match(list, /device-list-toolbar/);
  assert.match(list, /搜索设备名称、型号或账号/);
  assert.match(list, /全部状态/);
  assert.match(list, /filteredDevices/);
});
