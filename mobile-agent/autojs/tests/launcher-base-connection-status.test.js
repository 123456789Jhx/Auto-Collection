const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const launcherPath = path.join(__dirname, "..", "launcher.js");
const source = fs.readFileSync(launcherPath, "utf8");

test("launcher displays base, Agent, and collector status independently", () => {
  assert.match(source, /id="baseConnectionStatus"/);
  assert.match(source, /id="baseLastSuccess"/);
  assert.match(source, /id="agentHeartbeatStatus"/);
  assert.match(source, /id="mainStatus"/);
  assert.match(source, /AgriVideoCollectorBaseConnection/);
});

test("launcher derives business task status from the successful Agent heartbeat", () => {
  assert.match(source, /businessTask:/);
  assert.match(source, /businessUnknown:/);
  assert.match(source, /businessIdle:/);
  assert.match(source, /businessRunning:/);
  assert.match(source, /businessPaused:/);
  assert.match(source, /businessError:/);
  assert.match(source, /lastStatus: String\(store\.get\("lastStatus"/);
  assert.match(source, /currentTaskType: String\(store\.get\("currentTaskType"/);
  assert.match(source, /function businessTaskView\(agentConnected, agentState\)/);
  assert.match(source, /if \(!agentConnected\) return \{ text: TEXT\.businessUnknown/);
  assert.match(source, /if \(!agentState\.currentTaskType\) return \{ text: TEXT\.businessIdle/);
  assert.match(source, /ui\.mainStatus\.setText\(businessView\.text\)/);
  assert.doesNotMatch(source, /ui\.mainStatus\.setText\(mainRunning \? TEXT\.running : TEXT\.stopped\)/);
});

test("Agent heartbeat persists the reported business status only after a successful upload", () => {
  const heartbeatPath = path.join(__dirname, "..", "app", "heartbeat.js");
  const heartbeatSource = fs.readFileSync(heartbeatPath, "utf8");
  assert.match(heartbeatSource, /function recordAgentConnection\(result, status, message, taskType\)/);
  assert.match(heartbeatSource, /agentConnectionStore\.put\("lastStatus", String\(status \|\| "idle"\)\)/);
  assert.match(heartbeatSource, /agentConnectionStore\.put\("currentTaskType", String\(taskType \|\| ""\)\)/);
  assert.match(heartbeatSource, /recordAgentConnection\(uploadResult, payload\.status, payload\.lastMessage, payload\.currentTaskType\)/);
});

test("stop action never controls the native base connection", () => {
  const stopBlock = source
    .split("function stopAllScripts() {")[1]
    .split("\n}")[0];

  assert.match(stopBlock, /stopEngines\("watchdog\.js"\)/);
  assert.match(stopBlock, /stopEngines\("main\.js"\)/);
  assert.doesNotMatch(stopBlock, /BaseAgent|baseConnection|stopService/);
});

test("launcher shows readable base connection states and diagnostics", () => {
  assert.match(source, /baseOnline:/);
  assert.match(source, /baseReconnecting:/);
  assert.match(source, /baseOffline:/);
  assert.match(source, /offlineThresholdSeconds/);
  assert.match(source, /Math\.max\(state\.lastSuccessAt \|\| 0, state\.startedAt \|\| now\)/);
  assert.match(source, /state\.lastSuccessAt >= \(state\.startedAt \|\| 0\)/);
  assert.match(source, /elapsedSeconds <= 6/);
  assert.match(source, /elapsedSeconds < thresholdSeconds/);
  assert.match(source, /TEXT\.baseOnline/);
  assert.match(source, /TEXT\.baseReconnecting/);
  assert.match(source, /TEXT\.baseOffline/);
  assert.match(source, /networkTimeout:/);
  assert.match(source, /identityFailed:/);
  assert.match(source, /backendFailed:/);
  assert.match(source, /readableFailure/);
  assert.doesNotMatch(source, /now - state\.lastSuccessAt <= 35000/);
});

test("launcher remains usable on a small screen", () => {
  assert.match(source, /ui\.layout\(\s*<scroll>/);
});
