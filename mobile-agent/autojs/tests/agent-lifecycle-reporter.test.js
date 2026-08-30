const assert = require("assert");
const test = require("node:test");
const fs = require("fs");
const path = require("path");

const reporterPath = path.join(__dirname, "..", "app", "agent-lifecycle-reporter.js");
const launcherPath = path.join(__dirname, "..", "launcher.js");

test("lifecycle reporter sends stopped before the launcher force-stops scripts", () => {
  const reporter = require(reporterPath);
  const events = [];
  const storage = { get: () => "", put: (key, value) => events.push(["storage", key, value]) };
  const uploader = { uploadHeartbeat: (payload) => events.push(["heartbeat", payload]) };
  const instance = reporter.createAgentLifecycleReporter({
    config: { device: { deviceId: "device-1" }, app: { version: "1" }, task: { taskId: "task-1" } },
    uploader,
    storage,
    now: () => 1700000000000
  });

  const result = instance.reportStopped("LOCAL_STOP_BUTTON", "session-1");
  assert.equal(result.agentLifecycleState, "STOPPED");
  assert.equal(result.pollingEnabled, false);
  assert.equal(result.agentStateReason, "LOCAL_STOP_BUTTON");
  assert.equal(result.agentSessionId, "session-1");
  assert.equal(events.some((event) => event[0] === "heartbeat"), true);
});

test("lifecycle reporter creates a fresh session when the Agent starts", () => {
  const reporter = require(reporterPath);
  const payloads = [];
  const instance = reporter.createAgentLifecycleReporter({
    config: { device: { deviceId: "device-1" }, app: { version: "1" }, task: { taskId: "task-1" } },
    uploader: { uploadHeartbeat: (payload) => payloads.push(payload) },
    storage: { get: () => "", put: () => {} },
    now: () => 1700000000000,
    idFactory: () => "session-fresh"
  });

  const result = instance.reportRunning();
  assert.equal(result.agentLifecycleState, "RUNNING");
  assert.equal(result.pollingEnabled, true);
  assert.equal(result.agentSessionId, "session-fresh");
  assert.equal(payloads[0].agentLifecycleState, "RUNNING");
});

test("launcher reports stopped before stopping main and watchdog engines", () => {
  const source = fs.readFileSync(launcherPath, "utf8");
  const stopStart = source.indexOf("function stopAllScripts");
  const stopBody = source.slice(stopStart, stopStart + 1200);
  assert.ok(stopBody.indexOf("cancelActiveTasksBeforeStop") >= 0);
  assert.ok(stopBody.indexOf("cancelActiveTasksBeforeStop") < stopBody.indexOf("reportStoppedLifecycle"));
  assert.ok(stopBody.indexOf("reportStopped") < stopBody.indexOf('stopEngines("watchdog.js")'));
  assert.ok(source.indexOf("reportRunning") < source.indexOf("ensureManagedRuntime"));
});

test("uploader exposes a dedicated active-task cancellation request", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "core", "uploader.js"), "utf8");
  assert.match(source, /function cancelActiveAgentCommands/);
  assert.match(source, /\/mobile\/commands\/cancel-active/);
  assert.match(source, /cancelActiveAgentCommands: cancelActiveAgentCommands/);
});

test("shared heartbeat service restores a running lifecycle for remote-wake starts", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "app", "heartbeat.js"), "utf8");
  assert.match(source, /agentLifecycleState/);
  assert.match(source, /pollingEnabled/);
  assert.match(source, /RUNNING/);
  assert.match(source, /agentSessionId/);
});

test("uploader forwards lifecycle fields without rewriting the heartbeat contract", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "core", "uploader.js"), "utf8");
  assert.match(source, /agentLifecycleState: payload\.agentLifecycleState/);
  assert.match(source, /pollingEnabled: payload\.pollingEnabled/);
  assert.match(source, /agentSessionId: payload\.agentSessionId/);
});

test("launcher submits the bound task identity as a manual stop receipt", () => {
  const source = fs.readFileSync(launcherPath, "utf8");
  assert.match(source, /activeRunIdentity/);
  assert.match(source, /manual.*stop|MANUAL_STOP/i);
  assert.match(source, /reportManualAgentStop/);
});

test("manual stop logs attempt, HTTP response, and backend result", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "core", "uploader.js"), "utf8");
  assert.match(source, /手动停止任务请求开始/);
  assert.match(source, /手动停止任务回执完成[\s\S]*success/);
  assert.match(source, /responseBody/);
});

test("launcher exposes manual stop progress in logcat", () => {
  const source = fs.readFileSync(launcherPath, "utf8");
  assert.match(source, /停止运行按钮点击/);
  assert.match(source, /手动停止任务最终结果/);
  assert.match(source, /console\.log/);
});
