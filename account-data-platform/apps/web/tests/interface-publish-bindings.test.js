import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const apiPath = path.join(webRoot, "src/lib/api-client-interface-publish-bindings.ts");
const modalPath = path.join(webRoot, "src/routes/InterfacePublishBindingModal.tsx");
const panelPath = path.join(webRoot, "src/routes/InterfacePublishBindingsPanel.tsx");

test("接口发布提供独立匹配设备入口和完整绑定字段", () => {
  for (const file of [apiPath, modalPath, panelPath]) {
    assert(fs.existsSync(file), `${path.basename(file)} should exist`);
  }
  const modal = fs.readFileSync(modalPath, "utf8");
  const panel = fs.readFileSync(panelPath, "utf8");

  assert(panel.includes("匹配设备"));
  assert(panel.includes("UserSwitchOutlined"));
  for (const label of ["设备 ID", "抖音名称", "抖音号", "在线状态", "占用状态", "绑定状态"]) {
    assert(modal.includes(label), `missing ${label}`);
  }
  assert(modal.includes("Select"), "device must be selected from a list");
  assert(modal.includes("解除接口发布绑定"));
  assert(modal.includes("只会解除接口发布绑定，不会清空设备的其他业务资料"));
});

test("绑定组件只调用专用后端 API 并刷新预检", () => {
  const api = fs.readFileSync(apiPath, "utf8");
  const modal = fs.readFileSync(modalPath, "utf8");

  for (const method of [
    "getInterfacePublishBindings",
    "saveInterfacePublishBinding",
    "removeInterfacePublishBinding",
    "getInterfacePublishBindingPreflight"
  ]) {
    assert(api.includes(`function ${method}`), `missing ${method}`);
  }
  assert(api.includes('"/admin/interface-publish/bindings"'));
  assert(api.includes("/preflight"));
  assert(api.includes("put<"));
  assert(api.includes("remove<"));
  assert(modal.includes("invalidateQueries"));
  assert(modal.includes("BINDING_CONFLICT"));
  assert(modal.includes("该账号或设备已经存在启用绑定"));
  assert(modal.includes("DEVICE_OFFLINE"));
  assert(modal.includes("DEVICE_BUSY"));
  assert(modal.includes("[AIR-FILL: Q-002]"));
});

test("绑定组件不检查手机登录态、不包含视频号、模糊匹配或外部密钥", () => {
  const source = [modalPath, panelPath].map((file) => fs.readFileSync(file, "utf8")).join("\n");
  for (const forbidden of [
    "wechatChannels",
    "WECHAT_CHANNELS",
    "手机登录态",
    "fuzzy",
    "externalToken",
    "EXTERNAL_API_ACCESS_TOKEN"
  ]) {
    assert(!source.includes(forbidden), `forbidden binding behavior: ${forbidden}`);
  }
});
