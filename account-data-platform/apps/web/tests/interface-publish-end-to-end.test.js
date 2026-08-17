import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";
import { assessInterfacePublishManualStart } from "../src/lib/interface-publish-time.ts";

const webRoot = path.resolve(import.meta.dir, "..");
const files = {
  page: path.join(webRoot, "src/routes/PublishSchedulesPage.tsx"),
  control: path.join(webRoot, "src/routes/InterfacePublishRunControl.tsx"),
  bindings: path.join(webRoot, "src/routes/InterfacePublishBindingsPanel.tsx"),
  bindingModal: path.join(webRoot, "src/routes/InterfacePublishBindingModal.tsx"),
  monitor: path.join(webRoot, "src/routes/InterfacePublishRunMonitor.tsx"),
  alerts: path.join(webRoot, "src/routes/InterfacePublishAlertDrawer.tsx"),
  runApi: path.join(webRoot, "src/lib/api-client-interface-publish-runs.ts"),
  bindingApi: path.join(webRoot, "src/lib/api-client-interface-publish-bindings.ts"),
  monitorApi: path.join(webRoot, "src/lib/api-client-interface-publish-monitor.ts")
};

function read(name) {
  assert(fs.existsSync(files[name]), `${path.basename(files[name])} should exist`);
  return fs.readFileSync(files[name], "utf8");
}

test("接口发布页面只装配运行、匹配设备、监控和连接配置", () => {
  const page = read("page");
  for (const component of [
    "InterfacePublishRunControl",
    "InterfacePublishBindingsPanel",
    "InterfacePublishRunMonitor"
  ]) {
    assert(page.includes(component), `missing ${component}`);
  }
  for (const legacy of ["Fixed device publish plans", 'name="platforms"', 'name="timeWindows"']) {
    assert(!page.includes(legacy), `legacy interface-publish control remains: ${legacy}`);
  }
  assert(!page.includes("RemoteScriptsContent"));
  assert(!page.includes("新建远程脚本配置"));
  assert(!page.includes("Token 环境变量名"));
  assert(page.includes("固定接口连接"));
  assert(page.includes("测试连接"));
  assert(page.includes("固定接口配置尚未初始化"));
  assert(page.includes('.filter((config) => config.status === "ENABLED")'));
});

test("启动链路严格执行时间校验、绑定预检、用户确认和停止二次确认", () => {
  const control = read("control");
  for (const symbol of [
    "assessInterfacePublishManualStart",
    "preflightInterfacePublishRun",
    "confirmInterfacePublishRun",
    "stopInterfacePublishRun",
    "skippedBindingIds",
    "confirmedDailyFallbackRisk"
  ]) {
    assert(control.includes(symbol), `missing run-control step ${symbol}`);
  }
  for (const label of [
    "06:00-12:00",
    "13:00-24:00",
    "开启任务",
    "停止任务",
    "本次跳过",
    "停止中",
    "运行中如需修改，请先停止任务"
  ]) {
    assert(control.includes(label), `missing run-control state ${label}`);
  }
  assert(!control.includes("setInterval("));
  assert(!control.includes("PUBLISH_VIDEO_TASK"));
});

test("晚启动按上海时间要求重设发布时间并保留下午保底", () => {
  const times = { morningPublishTime: "09:00", afternoonPublishTime: "15:00" };
  assert.deepEqual(assessInterfacePublishManualStart(times, new Date("2026-08-06T01:30:00.000Z")), {
    valid: false,
    code: "RESET_MORNING",
    message: "上午发布时间已过，请重新设置当前时间之后的上午发布时间",
    warnings: []
  });
  assert.deepEqual(assessInterfacePublishManualStart(times, new Date("2026-08-06T08:00:00.000Z")), {
    valid: false,
    code: "RESET_AFTERNOON",
    message: "下午发布时间已过，请设置当前时间之后的发布时间",
    warnings: ["今日上午发布时间已过，今天只能执行下午发布"]
  });
});

test("匹配设备与告警处理均经项目后端且保留用户决定权", () => {
  const bindings = `${read("bindings")}\n${read("bindingModal")}`;
  const alerts = read("alerts");
  for (const label of ["匹配设备", "抖音名称", "抖音号", "设备", "保存绑定"]) {
    assert(bindings.includes(label), `missing binding operation ${label}`);
  }
  for (const behavior of ["Modal.confirm", "evidence", "SAFE_TO_RETRY", "实际成功", "实际失败"]) {
    assert(alerts.includes(behavior), `missing human-resolution behavior ${behavior}`);
  }
  assert(alerts.includes("[AIR-FILL: Q-006]"));
  assert(!alerts.includes("fetch("));
});

test("监控轮询覆盖三类错误、无素材等待和未知结果", () => {
  const monitor = read("monitor");
  for (const value of [
    "INTERFACE_FLOW_FAILED",
    "PUBLISH_EXECUTION_FAILED",
    "EXTERNAL_SYNC_FAILED",
    "NO_MATERIAL",
    "RESULT_UNKNOWN",
    "CLAIM_RESULT_UNKNOWN",
    "document.visibilityState",
    "refetchInterval"
  ]) {
    assert(monitor.includes(value), `missing monitoring signal ${value}`);
  }
});

test("所有接口发布客户端只访问项目后端", () => {
  const clients = [read("runApi"), read("bindingApi"), read("monitorApi")].join("\n");
  for (const route of [
    "/admin/interface-publish/runs",
    "/admin/interface-publish/bindings",
    "/admin/interface-publish/monitor"
  ]) {
    assert(clients.includes(route), `missing project backend route ${route}`);
  }
  for (const forbidden of [
    "/api/v1/external/publish-tasks",
    "wecom.dafengchan.top",
    "externalToken",
    "PUBLISH_VIDEO_TASK"
  ]) {
    assert(!clients.includes(forbidden), `client contains forbidden external behavior: ${forbidden}`);
  }
});
