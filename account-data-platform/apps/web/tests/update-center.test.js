import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const pagePath = path.join(webRoot, "src/routes/UpdateCenterPage.tsx");
const apiPath = path.join(webRoot, "src/lib/api-client-update-center.ts");
const sharedApiPath = path.join(webRoot, "src/lib/api-client.ts");

test("build publication uses an isolated long timeout", () => {
  const sharedApiSource = fs.readFileSync(sharedApiPath, "utf8");
  const updateApiSource = fs.readFileSync(apiPath, "utf8");

  assert(sharedApiSource.includes("const apiRequestTimeoutMs = 20_000"));
  assert(sharedApiSource.includes("timeoutMs = apiRequestTimeoutMs"));
  assert(sharedApiSource.includes("controller.abort(), timeoutMs"));
  assert(updateApiSource.includes("const bizScriptBuildTimeoutMs = 310_000"));
  assert(updateApiSource.includes("payload, true, bizScriptBuildTimeoutMs"));
});

test("更新中心使用独立的业务脚本构建发布与状态接口", () => {
  assert(fs.existsSync(apiPath), "update center api client should exist");
  const source = fs.readFileSync(apiPath, "utf8");

  assert(source.includes('channel: "biz-scripts"'));
  assert(source.includes('entryFile: "biz-script-manifest.json"'));
  assert(source.includes('status: "PUBLISHED"'));
  assert(source.includes('mutate<BizScriptRelease>("/admin/remote-scripts/releases"'));
  assert(source.includes('mutate<BizScriptRelease>("/admin/remote-scripts/releases/build"'));
  assert(source.includes('request<BizScriptReleasePage>("/admin/remote-scripts/releases"'));
  assert(source.includes('request<DeviceUpdateStatusPage>("/admin/remote-scripts/device-update-status"'));
  assert(!source.includes("/admin/remote-scripts/configs"));
});

test("更新中心一键构建发布当前脚本并展示真实版本与设备状态", () => {
  assert(fs.existsSync(pagePath), "UpdateCenterPage.tsx should exist");
  const source = fs.readFileSync(pagePath, "utf8");

  for (const text of [
    "业务脚本更新",
    "发布说明",
    "一键构建并发布当前业务脚本",
    "版本历史",
    "设备生效状态",
    "暂无设备更新上报"
  ]) {
    assert(source.includes(text), `missing update center text: ${text}`);
  }
  assert(source.includes("buildAndPublishBizScripts"));
  assert(source.includes("forceUpdate: false"));
  assert(source.includes("BUILD_IN_PROGRESS"));
  assert(source.includes("构建正在进行"));
  assert(source.includes("getBizScriptReleases"));
  assert(source.includes("getDeviceUpdateStatuses"));
  assert(source.includes("queryClient.invalidateQueries"));
  assert(source.includes('color={row.isCurrent ? "green" : updateStatusColor(value)}'));
  assert(source.includes('row.isCurrent ? "当前已生效" : updateStatusLabel(value)'));
  assert(!source.includes('name="version"'));
  assert(!source.includes('name="packageUrl"'));
  assert(!source.includes('name="sha256"'));
  assert(!source.includes('label="强制更新"'));
});

test("更新中心区分业务脚本与 APK 基座两个独立更新通道", () => {
  const pageSource = fs.readFileSync(pagePath, "utf8");
  const apiSource = fs.readFileSync(apiPath, "utf8");

  for (const text of ["业务脚本", "APK 基座", "基座版本", "业务脚本发布不会构建 APK"]) {
    assert(pageSource.includes(text), `missing update channel text: ${text}`);
  }
  assert(pageSource.includes("Tabs"));
  assert(pageSource.includes('useState("biz-scripts")'));
  assert(pageSource.includes("activeKey={activeTab}"));
  assert(pageSource.includes('key: "apk"'));
  assert(pageSource.includes("getAgentReleases"));
  assert(pageSource.includes("getAgentDeviceUpdateStatuses"));
  assert(pageSource.includes('channel = "stable"'));
  assert(pageSource.includes("agentVersionChannels"));
  assert(apiSource.includes('request<AgentReleasePage>("/admin/remote-scripts/releases"'));
  assert(apiSource.includes('request<DeviceUpdateStatusPage>("/admin/remote-scripts/device-update-status"'));
  assert(apiSource.includes("channel: channel"));
  assert(apiSource.includes('channel: "biz-scripts"'));
});

test("更新中心接入独立菜单与固定页面地址", () => {
  for (const filePath of [pagePath, apiPath]) {
    assert(fs.existsSync(filePath), `${path.basename(filePath)} should exist`);
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).length;
    assert(lines <= 400, `${path.basename(filePath)} has ${lines} lines`);
  }

  const appSource = fs.readFileSync(path.join(webRoot, "src/routes/App.tsx"), "utf8");
  assert(appSource.includes('import { UpdateCenterPage } from "./UpdateCenterPage"'));
  assert(appSource.includes('updateCenter: { title: "更新中心" }'));
  assert(appSource.includes('page === "updateCenter"'));
  assert(appSource.includes('window.location.pathname === "/update-center"'));
  assert(appSource.includes('nextPage === "updateCenter"'));
  assert(appSource.includes('key: "updateCenter"'));
  assert(appSource.includes('label: "更新中心"'));
  assert(!appSource.includes('key: "devices"'));
  assert(!appSource.includes('key: "records"'));
  assert(!appSource.includes('key: "dashboard"'));
});
