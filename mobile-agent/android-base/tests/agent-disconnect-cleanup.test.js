const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const javaRoot = path.join(__dirname, "..", "src", "main", "java", "com", "agri", "video", "collector", "base");
const read = (name) => fs.readFileSync(path.join(javaRoot, name), "utf8");
const autojsRoot = path.join(__dirname, "..", "..", "autojs");

test("external cleanup entry reuses the existing safe Douyin cleanup and stores an idempotent result", () => {
  const entry = fs.readFileSync(path.join(autojsRoot, "app", "emergency-agent-cleanup.js"), "utf8");
  assert.match(entry, /features\/new-comment\/cleanup\.js/);
  assert.match(entry, /AgriVideoCollectorEmergencyCleanup/);
  assert.match(entry, /cached|idempotent/i);
});

test("disconnect coordinator stops inner Agent, runs cleanup, and returns bounded stages", () => {
  const coordinator = read("AgentDisconnectCleanupCoordinator.kt");
  assert.match(coordinator, /AgentRuntimeStopper\(context\)\.stop\(\)/);
  assert.match(coordinator, /emergency-agent-cleanup\.js/);
  assert.match(coordinator, /EXIT_DOUYIN/);
  assert.match(coordinator, /OPEN_AGENT_HOME/);
  assert.match(coordinator, /timeout|TIMEOUT/i);
});

test("base exit command includes external cleanup stages in its acknowledgement", () => {
  const executor = read("BaseControlCommandExecutor.kt");
  const client = read("BaseControlClient.kt");
  assert.match(executor, /AgentDisconnectCleanupCoordinator\(context\)\.run/);
  assert.match(client, /cleanupStages/);
  assert.match(client, /result\.cleanupStages/);
});
