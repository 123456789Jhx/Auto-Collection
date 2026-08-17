import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "bun:test";
import * as publishTime from "../src/lib/interface-publish-time.ts";

const webRoot = path.resolve(import.meta.dir, "..");
const apiPath = path.join(webRoot, "src/lib/api-client-interface-publish-runs.ts");
const timePath = path.join(webRoot, "src/lib/interface-publish-time.ts");
const controlPath = path.join(webRoot, "src/routes/InterfacePublishRunControl.tsx");

test("接口发布运行控制使用固定窗口和专用后端 API", () => {
  for (const file of [apiPath, timePath, controlPath]) {
    assert(fs.existsSync(file), `${path.basename(file)} should exist`);
  }
  const api = fs.readFileSync(apiPath, "utf8");
  const control = fs.readFileSync(controlPath, "utf8");

  for (const method of [
    "getCurrentInterfacePublishRun",
    "preflightInterfacePublishRun",
    "confirmInterfacePublishRun",
    "stopInterfacePublishRun"
  ]) {
    assert(api.includes(`function ${method}`), `missing ${method}`);
  }
  assert(api.includes('"/admin/interface-publish/runs"'));
  assert(api.includes("/preflight"));
  assert(api.includes("/confirm"));
  assert(api.includes("/stop"));
  assert(control.includes("06:00-12:00"));
  assert(control.includes("13:00-24:00"));
  assert(control.includes("开启任务"));
  assert(control.includes("停止任务"));

  for (const forbidden of [
    "morningWindowStart",
    "afternoonWindowStart",
    "WECHAT_CHANNELS",
    'name="platforms"',
    'name="deviceId"',
    "externalToken",
    "setInterval(",
    "PUBLISH_VIDEO_TASK"
  ]) {
    assert(!control.includes(forbidden), `forbidden run-control behavior: ${forbidden}`);
  }
});

test("发布时间只接受两个固定窗口内的具体时间", () => {
  assert.equal(typeof publishTime.validateInterfacePublishRunTimes, "function");
  const validate = publishTime.validateInterfacePublishRunTimes;

  assert.deepEqual(validate("09:00", "15:00"), { valid: true });
  for (const [morning, afternoon] of [
    ["05:59", "15:00"],
    ["12:00", "15:00"],
    ["09:00", "12:59"],
    ["09:00", "24:00"]
  ]) {
    assert.deepEqual(validate(morning, afternoon), {
      valid: false,
      code: "INVALID_TIME",
      message: "当前输入时间不合法"
    });
  }
});

test("手动启动按上海时间处理上午错过和下午保底", () => {
  assert.equal(typeof publishTime.assessInterfacePublishManualStart, "function");
  const assess = publishTime.assessInterfacePublishManualStart;
  const base = { morningPublishTime: "09:00", afternoonPublishTime: "15:00" };

  assert.deepEqual(assess(base, new Date("2026-08-06T01:30:00.000Z")), {
    valid: false,
    code: "RESET_MORNING",
    message: "上午发布时间已过，请重新设置当前时间之后的上午发布时间",
    warnings: []
  });
  assert.deepEqual(assess(base, new Date("2026-08-06T04:30:00.000Z")), {
    valid: true,
    code: "MORNING_PASSED",
    warnings: ["今日上午发布时间已过，今天只能执行下午发布"]
  });
  assert.deepEqual(assess(base, new Date("2026-08-06T08:00:00.000Z")), {
    valid: false,
    code: "RESET_AFTERNOON",
    message: "下午发布时间已过，请设置当前时间之后的发布时间",
    warnings: ["今日上午发布时间已过，今天只能执行下午发布"]
  });
  assert.equal(assess({ ...base, afternoonPublishTime: "17:00" }, new Date("2026-08-06T08:00:00.000Z")).valid, true);
});

test("启动严格经过预检、本次跳过和用户确认", () => {
  const control = fs.readFileSync(controlPath, "utf8");

  for (const symbol of [
    "getCurrentInterfacePublishRun",
    "preflightInterfacePublishRun",
    "confirmInterfacePublishRun",
    "assessInterfacePublishManualStart",
    "skippedBindingIds",
    "invalidateQueries"
  ]) {
    assert(control.includes(symbol), `missing run flow: ${symbol}`);
  }
  for (const label of [
    "上午发布时间",
    "下午发布时间",
    "最大同时发布设备数",
    "本次跳过",
    "绑定完整",
    "字段不完整",
    "绑定冲突",
    "设备离线",
    "设备繁忙"
  ]) {
    assert(control.includes(label), `missing run-control label: ${label}`);
  }
  assert(control.includes("WAITING_USER_CONFIRMATION"));
  assert(control.includes("运行中如需修改，请先停止任务"));
  assert(!control.includes("claimInterface"));
});

test("停止风险二次确认后进入停止中并刷新本地运行", () => {
  const control = fs.readFileSync(controlPath, "utf8");

  assert(control.includes("stopInterfacePublishRun"));
  assert(control.includes("confirmedDailyFallbackRisk"));
  assert(control.includes("RUN_STOP_CONFIRMATION_REQUIRED"));
  assert(control.includes("incompleteAccountCount"));
  assert(control.includes("停止后这些账号今天可能无法完成保底发布"));
  assert(control.includes("STOPPING"));
  assert(control.includes("停止中"));
  assert(!control.includes("setInterval("));
});

test("刷新页面后可以继续确认等待中的启动预检", () => {
  const control = fs.readFileSync(controlPath, "utf8");

  assert(control.includes("getInterfacePublishBindingPreflight"));
  assert(control.includes("继续启动确认"));
  assert(control.includes('currentRun.status === "WAITING_USER_CONFIRMATION"'));
});
