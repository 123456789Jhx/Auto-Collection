const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const javaRoot = path.join(__dirname, "..", "src", "main", "java", "com", "agri", "video", "collector", "base");
const read = (name) => fs.readFileSync(path.join(javaRoot, name), "utf8");

test("polls BASE commands on a scheduler separate from heartbeat", () => {
  const service = read("BaseConnectivityService.kt");
  assert.match(service, /heartbeatExecutor/);
  assert.match(service, /controlExecutor/);
  assert.match(service, /startHeartbeatLoop\(\)/);
  assert.match(service, /startControlLoop\(\)/);
  assert.match(service, /CONTROL_POLL_INTERVAL_MS/);
});

test("control client uses the dedicated BASE channel and claim-token ACK", () => {
  const client = read("BaseControlClient.kt");
  const protocol = read("BaseConnectivityProtocol.kt");
  assert.match(client, /base-control\/commands/);
  assert.match(client, /claimToken/);
  assert.match(client, /acknowledge/);
  assert.match(client, /canonicalRequest\(method, url, timestamp, bodyHash\)/);
  assert.match(protocol, /fun canonicalRequest\(method: String, url: String, timestamp: String, bodyHash: String\)/);
  assert.match(protocol, /listOf\(method\.uppercase\(\), path, query, timestamp, bodyHash\)/);
  assert.doesNotMatch(client, /executorType=AGENT/);
});

test("executor supports only BASE lifecycle commands", () => {
  const executor = read("BaseControlCommandExecutor.kt");
  assert.match(executor, /"OPEN_AGENT_APP"/);
  assert.match(executor, /"START_AGENT"/);
  assert.match(executor, /"EXIT_AGENT_APP"/);
  assert.match(executor, /AppUiForegroundController\(context\)\.ensureForeground\(appUiState\)/);
  assert.match(executor, /AgentRuntimeStopper\(context\)\.stop\(\)/);
  assert.doesNotMatch(executor, /PUBLISH/i);
});

test("locked BASE actions wake and dismiss the unsecured keyguard before touching App or Agent", () => {
  const executor = read("BaseControlCommandExecutor.kt");
  const unlock = read("BaseScreenUnlockActivity.kt");
  const manifest = require("fs").readFileSync(
    require("path").join(__dirname, "..", "src", "main", "AndroidManifest.xml"),
    "utf8",
  );

  assert.match(executor, /ScreenStateDetector\(context\)\.detect\(\)/);
  assert.match(executor, /val appUiState = AppUiStateDetector\(context\)\.detect\(\)/);
  assert.match(executor, /BaseScreenUnlockActivity\.unlock\(context\)/);
  assert.match(executor, /ensureForeground\(appUiState\)/);
  const foregroundBlock = executor.slice(
    executor.indexOf("private fun ensureAppForeground"),
    executor.indexOf("private fun startAgent"),
  );
  const startBlock = executor.slice(
    executor.indexOf("private fun startAgent"),
    executor.indexOf("private fun ensureScreenReady"),
  );
  assert.ok(
    foregroundBlock.indexOf("ensureScreenReady()") <
      foregroundBlock.indexOf("AppUiForegroundController(context).ensureForeground(appUiState)"),
    "screen unlock must finish before restoring the App",
  );
  assert.ok(
    startBlock.indexOf("ensureScreenReady()") <
      startBlock.indexOf("AppUiForegroundController(context).ensureForeground(appUiState)"),
    "screen unlock must finish before starting Agent",
  );
  assert.match(unlock, /setShowWhenLocked\(true\)/);
  assert.match(unlock, /setTurnScreenOn\(true\)/);
  assert.match(unlock, /requestDismissKeyguard/);
  assert.match(unlock, /CountDownLatch/);
  assert.match(unlock, /override fun onDestroy\(\)/);
  assert.match(unlock, /requestId\?\.let\s*\{[^}]*pending\[[^\]]+\]\?\.complete\(unlockSucceeded\)/);
  assert.match(manifest, /com\.agri\.video\.collector\.base\.BaseScreenUnlockActivity/);
  assert.match(manifest, /android\.permission\.WAKE_LOCK/);
});

test("Agent starter deduplicates main and watchdog engines", () => {
  const starter = read("AgentRuntimeStarter.kt");
  assert.match(starter, /getScriptExecutions\(\)/);
  assert.match(starter, /main\.js/);
  assert.match(starter, /watchdog\.js/);
  assert.match(starter, /engine\?\.isDestroyed/);
  assert.match(starter, /@Synchronized/);
  assert.match(starter, /JavaScriptFileSource/);
  assert.match(starter, /isAgentHeartbeatFresh/);
  assert.match(starter, /if \(mainRunning && watchdogRunning && isAgentHeartbeatFresh\(startedAt\)\)/);
});

test("Agent starter identifies custom-named engines by their real script files", () => {
  const starter = read("AgentRuntimeStarter.kt");
  assert.match(
    starter,
    /\(execution\.source\s+as\?\s+JavaScriptFileSource\)\?\.file/,
  );
  assert.doesNotMatch(starter, /execution\.source\.fullPath/);
});

test("Agent starter submits main before watchdog", () => {
  const starter = read("AgentRuntimeStarter.kt");
  const mainStart = starter.indexOf(
    'service.execute(JavaScriptFileSource("main", mainFile), config)',
  );
  const watchdogStart = starter.indexOf(
    'service.execute(JavaScriptFileSource("watchdog", watchdogFile), config)',
  );

  assert.notStrictEqual(mainStart, -1, "main execution call is missing");
  assert.notStrictEqual(watchdogStart, -1, "watchdog execution call is missing");
  assert.ok(mainStart < watchdogStart, "main must be submitted before watchdog");
});

test("Agent start is confirmed by a fresh heartbeat instead of script submission", () => {
  const starter = read("AgentRuntimeStarter.kt");
  assert.match(starter, /AgriVideoCollectorAgentConnection/);
  assert.match(starter, /lastSuccessAt/);
  assert.match(starter, /waitForAgentReady/);
  assert.match(starter, /START_CONFIRM_TIMEOUT_MS/);
  assert.match(starter, /READY_TIMEOUT/);

  const firstExecute = starter.indexOf("service.execute(");
  const readyWait = starter.indexOf("waitForAgentReady(", firstExecute);
  const startedResult = starter.indexOf("Result.STARTED", firstExecute);
  assert.ok(firstExecute >= 0, "Agent scripts must be submitted");
  assert.ok(readyWait > firstExecute, "readiness must be checked after script submission");
  assert.ok(startedResult > readyWait, "STARTED must only be returned after readiness confirmation");
});

test("Agent readiness fails when main.js exits before its heartbeat", () => {
  const starter = read("AgentRuntimeStarter.kt");
  const executor = read("BaseControlCommandExecutor.kt");
  assert.match(starter, /observedMainRunning/);
  assert.match(starter, /if \(observedMainRunning && !mainRunning && submittedEngine\?\.isDestroyed != false\)/);
  assert.match(starter, /heartbeatAt > heartbeatBeforeStart && heartbeatAt >= startedAt && mainRunning/);
  assert.match(starter, /return false/);
  assert.match(executor, /READY_TIMEOUT/);
});

test("command is acknowledged before local execution state is released", () => {
  const runtime = read("BaseControlRuntime.kt");
  assert.match(runtime, /activeCommandId/);
  assert.match(runtime, /client\.acknowledge/);
  assert.match(runtime, /finally/);
  assert.match(runtime, /activeCommandId = null/);
});

test("unexpected EXIT_AGENT_APP execution failures keep a structured three-stage result", () => {
  const runtime = read("BaseControlRuntime.kt");

  const catchBranch = runtime.slice(
    runtime.indexOf("} catch (_: Throwable)"),
    runtime.indexOf("} finally", runtime.indexOf("} catch (_: Throwable)")),
  );
  assert.match(catchBranch, /executionFailureResult\(command\)/);
  assert.match(runtime, /command\.commandType\s*==\s*"EXIT_AGENT_APP"/);
  assert.match(runtime, /ExitResult/);
  assert.match(
    runtime,
    /BaseControlCommandExecutor\.Stage\(\s*"STOP_AGENT",\s*"FAILED",\s*"UNEXPECTED_ERROR"\s*\)/,
  );
  assert.match(runtime, /"REMOVE_APP_TASK"/);
  assert.match(runtime, /"LOCK_SCREEN"/);
  assert.match(runtime, /"REMOVE_APP_TASK"[\s\S]*"SKIPPED"[\s\S]*"PREVIOUS_STAGE_FAILED"/);
  assert.match(runtime, /"LOCK_SCREEN"[\s\S]*"SKIPPED"[\s\S]*"PREVIOUS_STAGE_FAILED"/);
  assert.match(runtime, /transportStatus\s*=\s*"FAILED"/);
});

test("acknowledge failures preserve the executed result for retry", () => {
  const runtime = read("BaseControlRuntime.kt");
  const executionBlock = runtime.slice(
    runtime.indexOf("val result = try"),
    runtime.indexOf("finally", runtime.indexOf("val result = try")),
  );

  assert.match(executionBlock, /catch\s*\(_:\s*Throwable\)\s*\{[\s\S]*executionFailureResult\(command\)/);
  assert.doesNotMatch(executionBlock, /client\.acknowledge[\s\S]*catch/);
  assert.match(executionBlock, /cacheCompletedResult\(command\.id,\s*result\)/);
});
