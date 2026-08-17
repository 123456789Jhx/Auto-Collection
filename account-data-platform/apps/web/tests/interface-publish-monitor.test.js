import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";

const webRoot = path.resolve(import.meta.dir, "..");
const apiPath = path.join(webRoot, "src/lib/api-client-interface-publish-monitor.ts");
const monitorPath = path.join(webRoot, "src/routes/InterfacePublishRunMonitor.tsx");
const drawerPath = path.join(webRoot, "src/routes/InterfacePublishAlertDrawer.tsx");
const schedulesPath = path.join(webRoot, "src/routes/PublishSchedulesPage.tsx");

test("接口页面装配运行控制、匹配设备和运行监控", () => {
  const schedules = fs.readFileSync(schedulesPath, "utf8");

  for (const component of [
    "InterfacePublishRunControl",
    "InterfacePublishBindingsPanel",
    "InterfacePublishRunMonitor"
  ]) {
    assert(schedules.includes(component), `missing ${component}`);
  }
  assert(!schedules.includes("Fixed device publish plans"));
  assert(!schedules.includes('name="platforms"'));
  assert(!schedules.includes('name="timeWindows"'));
});

test("监控客户端只调用项目后端的详情和人工处理路由", () => {
  for (const file of [apiPath, monitorPath, drawerPath]) {
    assert(fs.existsSync(file), `${path.basename(file)} should exist`);
  }
  const api = fs.readFileSync(apiPath, "utf8");
  for (const method of [
    "getInterfacePublishRunDetails",
    "markInterfacePublishAlertRead",
    "resolveInterfacePublishResultUnknown",
    "resolveInterfacePublishClaimUnknown"
  ]) {
    assert(api.includes(`function ${method}`), `missing ${method}`);
  }
  assert(api.includes('"/admin/interface-publish/monitor"'));
  assert(api.includes("/resolve-result"));
  assert(api.includes("/resolve-claim"));
  assert(!api.includes("wecom.dafengchan.top"));
  assert(!api.includes("Authorization"));
});

test("运行监控分别展示三类错误和关键运行状态", () => {
  const monitor = fs.readFileSync(monitorPath, "utf8");
  for (const category of [
    "INTERFACE_FLOW_FAILED",
    "PUBLISH_EXECUTION_FAILED",
    "EXTERNAL_SYNC_FAILED"
  ]) {
    assert(monitor.includes(category), `missing category ${category}`);
  }
  for (const label of [
    "接口流程失败",
    "发布执行失败",
    "外部状态同步失败",
    "发布成功，外部状态待同步",
    "NO_MATERIAL",
    "下次重试",
    "等待设备",
    "RESULT_UNKNOWN",
    "CLAIM_RESULT_UNKNOWN"
  ]) {
    assert(monitor.includes(label), `missing monitor label ${label}`);
  }
  assert(monitor.includes("document.visibilityState"));
  assert(monitor.includes("refetchInterval"));
});

test("未知结果只能填写证据后二次确认并调用本地后端", () => {
  const drawer = fs.readFileSync(drawerPath, "utf8");

  assert(drawer.includes("evidence"));
  assert(drawer.includes("Modal.confirm"));
  assert(drawer.includes("实际成功"));
  assert(drawer.includes("实际失败"));
  assert(drawer.includes("SAFE_TO_RETRY"));
  assert(drawer.includes("重复领取风险"));
  assert(drawer.includes("[AIR-FILL: Q-006]"));
  assert(!drawer.includes("fetch("));
  assert(!drawer.includes("wecom.dafengchan.top"));
});

test("人工处理前展示账号、设备和本地任务上下文", () => {
  const monitor = fs.readFileSync(monitorPath, "utf8");
  const drawer = fs.readFileSync(drawerPath, "utf8");

  assert(monitor.includes("alertContexts"));
  assert(drawer.includes("alertContexts"));
  for (const label of ["账号", "设备", "本地任务"]) {
    assert(drawer.includes(label), `missing alert context ${label}`);
  }
});
