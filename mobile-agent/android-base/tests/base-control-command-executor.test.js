const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const javaRoot = path.join(
  __dirname,
  "..",
  "src",
  "main",
  "java",
  "com",
  "agri",
  "video",
  "collector",
  "base",
);
const read = (name) => fs.readFileSync(path.join(javaRoot, name), "utf8");

test("EXIT_AGENT_APP is a staged base command and never stops the outer base", () => {
  const executor = read("BaseControlCommandExecutor.kt");

  assert.match(executor, /"EXIT_AGENT_APP"\s*->\s*exitAgentApp\(command\)/);
  assert.match(executor, /AgentRuntimeStopper\(context\)\.stop\(\)/);
  assert.match(executor, /AppUiForegroundController\(context\)\.removeTask\(\)/);
  assert.match(executor, /ScreenLockController\(context\)\.lock\(\)/);
  assert.match(executor, /Stage\("STOP_AGENT"/);
  assert.match(executor, /Stage\("REMOVE_APP_TASK"/);
  assert.match(executor, /Stage\("LOCK_SCREEN"/);
  assert.match(executor, /exitResult\("PARTIAL",\s*"DONE"/);
  assert.match(executor, /BaseConnectivityService\.requestImmediateHeartbeat\(context\)/);
  assert.doesNotMatch(executor, /BaseConnectivityService.*stop|stopService|killProcess|am force-stop|force-stop package/i);
});

test("EXIT_AGENT_APP always returns the fixed ordered stage envelope, including early failures", () => {
  const executor = read("BaseControlCommandExecutor.kt");

  assert.match(executor, /STOP_AGENT.*REMOVE_APP_TASK.*LOCK_SCREEN/s);
  assert.match(executor, /PREVIOUS_STAGE_FAILED/);
  assert.match(
    executor,
    /Stage\("REMOVE_APP_TASK",\s*"SKIPPED",\s*"PREVIOUS_STAGE_FAILED"\)/,
  );
  assert.match(
    executor,
    /Stage\("LOCK_SCREEN",\s*"SKIPPED",\s*"PREVIOUS_STAGE_FAILED"\)/,
  );
  assert.match(executor, /MALFORMED_PAYLOAD[\s\S]*PREVIOUS_STAGE_FAILED/);
  assert.match(executor, /STOP_AGENT_FAILED[\s\S]*REMOVE_APP_TASK_FAILED/);
});

test("EXIT_AGENT_APP parses lockScreen strictly and defaults it to false", () => {
  const client = read("BaseControlClient.kt");
  const executor = read("BaseControlCommandExecutor.kt");

  assert.match(client, /val payload:\s*JSONObject/);
  assert.match(client, /item\.optJSONObject\("payload"\)/);
  assert.match(executor, /payload\.has\("lockScreen"\)/);
  assert.match(executor, /payload\.opt\("lockScreen"\)\s+is\s+Boolean/);
  assert.match(executor, /return false/);
  assert.match(executor, /MALFORMED_LOCK_SCREEN/);
});

test("EXIT_AGENT_APP rejects unknown keys and non-object payloads before changing state", () => {
  const client = read("BaseControlClient.kt");
  const executor = read("BaseControlCommandExecutor.kt");

  assert.match(executor, /payload\.keys\(\)/);
  assert.match(executor, /UNKNOWN_PAYLOAD_KEY/);
  assert.match(executor, /payloadMalformed/);
  assert.match(client, /item\.has\("payload"\)/);
  assert.match(client, /item\.opt\("payload"\)/);
  assert.match(client, /payloadMalformed/);
});

test("EXIT_AGENT_APP serializes the full composite sequence per process", () => {
  const executor = read("BaseControlCommandExecutor.kt");

  assert.match(executor, /ReentrantLock/);
  assert.match(executor, /withLock/);
  assert.match(executor, /exitLock/i);
  assert.match(executor, /exitAgentApp[\s\S]*withLock/);
});

test("AgentRuntimeStopper stops only main and watchdog engines by canonical path", () => {
  const stopper = read("AgentRuntimeStopper.kt");

  assert.match(stopper, /main\.js/);
  assert.match(stopper, /watchdog\.js/);
  assert.match(stopper, /canonicalPath/);
  assert.match(stopper, /getScriptExecutions\(\)/);
  assert.match(stopper, /engine\?\.isDestroyed == false/);
  assert.match(stopper, /engine\?\.forceStop\(\)/);
  assert.doesNotMatch(stopper, /killProcess|stopService|am force-stop/i);
});

test("ScreenLockController uses accessibility lock-screen action as an optional partial stage", () => {
  const lock = read("ScreenLockController.kt");

  assert.match(lock, /GlobalActionAutomator/);
  assert.match(lock, /lockScreen\(\)/);
  assert.match(lock, /ScreenStateDetector\(context\)\.detect\(\)\s*==\s*ScreenState\.LOCKED/);
  assert.match(lock, /ALREADY_LOCKED/);
  assert.match(lock, /LOCK_FAILED/);
});

test("BaseControlClient sends structured EXIT_AGENT_APP ACK results", () => {
  const client = read("BaseControlClient.kt");

  assert.match(client, /result\.exitResult/);
  assert.match(client, /"commandType"/);
  assert.match(client, /"EXIT_AGENT_APP"/);
  assert.match(client, /"stages"/);
  assert.match(client, /JSONArray/);
  assert.match(client, /transportStatus/);
});

test("BaseControlClient emits EXIT stages in the canonical three-stage order", () => {
  const client = read("BaseControlClient.kt");

  assert.match(client, /STOP_AGENT.*REMOVE_APP_TASK.*LOCK_SCREEN/s);
  assert.match(client, /PREVIOUS_STAGE_FAILED/);
  assert.match(client, /normalizeExitStages|canonicalExitStages|EXIT_STAGE_NAMES/);
});

test("BaseControlRuntime keeps duplicate command IDs idempotent and bounded", () => {
  const runtime = read("BaseControlRuntime.kt");

  assert.match(runtime, /completedResultsByCommandId/);
  assert.match(runtime, /cacheCompletedResult/);
  assert.match(runtime, /MAX_COMPLETED_RESULT_CACHE_SIZE/);
  assert.match(runtime, /pendingResult/);
  assert.match(runtime, /command\.id/);
});
