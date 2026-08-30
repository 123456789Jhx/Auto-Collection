const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("养号桥接器有活动任务时主循环必须保持 running 状态", () => {
  const collector = require("../app/collector-app.js");
  assert.equal(typeof collector.resolveCollectorAgentStatus, "function");
  assert.equal(collector.resolveCollectorAgentStatus({ running: false, paused: false, stopRequested: false }, true), "running");
});

test("业务脚本更新在预加载前检查，并在空闲循环持续检查", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/collector-app.js"), "utf8");
  const startupIdle = source.indexOf("floatyControl.update(startupIdleState);");
  const startupCheck = source.indexOf("var bizScriptUpdate = checkBizScriptVersion(true);");
  const preload = source.indexOf("controlLoop.preloadPublishVideoHandler();");
  const idleCheck = source.indexOf("var bizScriptIdleUpdate = checkBizScriptVersion(false);");
  const agentCheck = source.indexOf("checkAgentVersion(false);");

  assert(startupIdle >= 0, "fresh agent must enter idle before checking business scripts");
  assert(startupCheck > startupIdle, "startup must enter idle before checking business script updates");
  assert(preload > startupCheck, "business script updates must be checked before publish preloading");
  assert(idleCheck >= 0, "idle loop must continue checking business script updates");
  assert(agentCheck > idleCheck, "business script check must run before stable APK version check");
});

test("业务脚本所有检查入口只允许 idle 状态执行", () => {
  const source = fs.readFileSync(path.join(__dirname, "../app/collector-app.js"), "utf8");
  const checkFunction = source.indexOf("function checkBizScriptVersion(force)");
  const statusRead = source.indexOf("var status = currentAgentStatus();", checkFunction);
  const idleGuard = source.indexOf('if (status !== "idle")', statusRead);
  const updaterCheck = source.indexOf("return context.bizScriptUpdater.check(force);", checkFunction);

  assert(checkFunction >= 0, "business script check helper must exist");
  assert(statusRead > checkFunction, "business script check helper must read the current status");
  assert(idleGuard > statusRead, "business script check helper must reject non-idle states");
  assert(updaterCheck > idleGuard, "idle gate must run before the updater check");
});
