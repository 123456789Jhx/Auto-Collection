var assert = require("assert");
var createBridge = require("../app/account-warmup-command-bridge.js").createAccountWarmupCommandBridge;

function command(id, type, payload) {
  return { id: id, commandType: type, payload: payload || {} };
}

function createHarness(commandSets, ackResults, featureStatus) {
  var acknowledgements = [];
  var events = [];
  var queuedThreads = [];
  var startCount = 0;
  var pollIndex = 0;
  var runnerOptions = null;
  var moduleLoadCalls = [];
  var baselineModuleLoadCalls = [];
  var uploader = {
    pollCommands: function () { return commandSets[Math.min(pollIndex++, commandSets.length - 1)] || []; },
    ackCommand: function (id, status, result) {
      acknowledgements.push({ id: id, status: status, result: result });
      events.push("ack:" + id + ":" + status);
      return ackResults && ackResults.length ? ackResults.shift() : {};
    }
  };
  var context = {
    uploader: uploader,
    logger: { info: function () {}, warn: function () {}, error: function () {} },
    loadBizScript: function (modulePath) {
      moduleLoadCalls.push(modulePath);
      return {
        createAccountWarmupRegistry: function () {
          return {
            create: function (featureKey) {
              return { run: function (payload, options) {
                runnerOptions = options;
                return options.shouldStop() ? { status: "STOPPED" } : { status: featureStatus || "TARGET_LIVE_ENTERED" };
              } };
            }
          };
        }
      };
    },
    loadBaselineScript: function (modulePath) {
      baselineModuleLoadCalls.push(modulePath);
      return {
        createDouyinPostPublishCleanup: function () {
          return {
            run: function () {
              events.push("cleanup-stop");
              return { completed: true };
            }
          };
        }
      };
    },
    startThread: function (runner) {
      startCount += 1;
      queuedThreads.push(runner);
      return { interrupt: function () { events.push("interrupt-worker"); } };
    },
    returnToAgent: function () { events.push("forbidden-direct-launch"); return true; }
  };
  return {
    context: context,
    acknowledgements: acknowledgements,
    events: events,
    queuedThreads: queuedThreads,
    getStartCount: function () { return startCount; },
    getRunnerOptions: function () { return runnerOptions; },
    getModuleLoadCalls: function () { return moduleLoadCalls; },
    getBaselineModuleLoadCalls: function () { return baselineModuleLoadCalls; }
  };
}

function testStopImmediatelyInterruptsAndCleansUpBeforeWorkerReturns() {
  var warmup = command("run-stop-immediate", "ACCOUNT_WARMUP_RUN", {
    featureKey: "target_live_interaction",
    batchId: "batch-stop-immediate",
    config: {}
  });
  var stop = command("stop-immediate", "ACCOUNT_WARMUP_STOP", {
    targetCommandId: warmup.id,
    batchId: "batch-stop-immediate"
  });
  var harness = createHarness([[warmup], [stop]]);
  var bridge = createBridge(harness.context);
  bridge.install();

  harness.context.uploader.pollCommands();
  harness.context.uploader.pollCommands();

  assert.deepStrictEqual(harness.events.slice(0, 4), [
    "interrupt-worker",
    "cleanup-stop",
    "ack:stop-immediate:DONE",
    "ack:run-stop-immediate:DONE"
  ]);
  assert.strictEqual(harness.events.indexOf("forbidden-direct-launch"), -1);
  assert.strictEqual(bridge.getActive(), null);
}

function testPreloadsRegistryBeforeWorkerExecution() {
  var warmup = command("run-preloaded", "ACCOUNT_WARMUP_RUN", {
    featureKey: "target_live_interaction",
    batchId: "batch-preloaded",
    config: {}
  });
  var harness = createHarness([[warmup]]);
  var bridge = createBridge(harness.context);
  bridge.install();

  assert.deepStrictEqual(harness.getModuleLoadCalls(), [
    "features/publish-video/douyin-post-publish-cleanup.js",
    "features/account-warmup/registry.js"
  ]);
  assert.deepStrictEqual(harness.getBaselineModuleLoadCalls(), ["features/publish-video/douyin-post-publish-cleanup.js"]);
  harness.context.loadBizScript = function () {
    throw new Error("worker execution must not load account warmup modules");
  };

  harness.context.uploader.pollCommands();
  harness.queuedThreads[0]();
  assert.deepStrictEqual(harness.acknowledgements[0], {
    id: "run-preloaded",
    status: "DONE",
    result: { status: "TARGET_LIVE_ENTERED" }
  });
}

function testMaintainsRunIdentityForActiveWarmupTask() {
  var warmup = command("run-identity", "ACCOUNT_WARMUP_RUN", {
    featureKey: "video_warmup",
    batchId: "batch-identity",
    runId: "run-identity-explicit",
    config: {}
  });
  var harness = createHarness([[warmup]]);
  var bridge = createBridge(harness.context);
  bridge.install();

  harness.context.uploader.pollCommands();

  assert.deepStrictEqual(bridge.getActive().runIdentity, {
    runId: "run-identity-explicit",
    batchId: "batch-identity",
    featureKey: "video_warmup"
  });
}

function testClearsRunIdentityAfterTerminalAck() {
  var warmup = command("run-identity-clear", "ACCOUNT_WARMUP_RUN", {
    featureKey: "video_warmup",
    batchId: "batch-identity-clear",
    runId: "run-identity-clear",
    config: {}
  });
  var harness = createHarness([[warmup]]);
  var bridge = createBridge(harness.context);
  bridge.install();

  harness.context.uploader.pollCommands();
  assert.strictEqual(harness.context.accountWarmupRunIdentity.runId, "run-identity-clear");
  harness.queuedThreads[0]();
  assert.strictEqual(harness.context.accountWarmupRunIdentity, null);
}

function testRetriesFailedTerminalAckWithoutRerunningFeature() {
  var warmup = command("run-ack", "ACCOUNT_WARMUP_RUN", {
    featureKey: "target_live_interaction",
    batchId: "batch-ack",
    config: {}
  });
  var harness = createHarness([[warmup], [warmup]], [{ success: false }, {}]);
  var bridge = createBridge(harness.context);
  bridge.install();

  harness.context.uploader.pollCommands();
  harness.queuedThreads[0]();
  harness.context.uploader.pollCommands();

  assert.strictEqual(harness.getStartCount(), 1);
  assert.strictEqual(harness.acknowledgements.length, 2);
  assert.strictEqual(bridge.getActive(), null);
}

function testInterceptsWarmupAndPassesOtherCommandsThrough() {
  var warmup = command("run-1", "ACCOUNT_WARMUP_RUN", { featureKey: "target_live_interaction", batchId: "batch-1", config: {} });
  var status = command("status-1", "STATUS");
  var harness = createHarness([[warmup, status]]);
  var bridge = createBridge(harness.context);
  bridge.install();

  assert.deepStrictEqual(harness.context.uploader.pollCommands(), [status]);
  assert.strictEqual(harness.getStartCount(), 1);
  harness.queuedThreads[0]();
  assert.deepStrictEqual(harness.acknowledgements[0], {
    id: "run-1",
    status: "DONE",
    result: { status: "TARGET_LIVE_ENTERED" }
  });
}

function testSuppressesDuplicateFetchedRunAndSignalsStop() {
  var warmup = command("run-1", "ACCOUNT_WARMUP_RUN", { featureKey: "target_live_interaction", batchId: "batch-1", config: {} });
  var stop = command("stop-1", "ACCOUNT_WARMUP_STOP", { batchId: "batch-1", targetCommandId: "run-1" });
  var harness = createHarness([[warmup], [warmup], [warmup, stop]]);
  var bridge = createBridge(harness.context);
  bridge.install();

  harness.context.uploader.pollCommands();
  harness.context.uploader.pollCommands();
  harness.context.uploader.pollCommands();
  assert.strictEqual(harness.getStartCount(), 1);
  harness.queuedThreads[0]();
  assert(harness.acknowledgements.some(function (item) {
    return item.id === "stop-1" && item.status === "DONE";
  }));
  assert(harness.acknowledgements.some(function (item) {
    return item.id === "run-1" && item.result.status === "STOPPED";
  }));
}

testInterceptsWarmupAndPassesOtherCommandsThrough();
testSuppressesDuplicateFetchedRunAndSignalsStop();
testRetriesFailedTerminalAckWithoutRerunningFeature();
testPreloadsRegistryBeforeWorkerExecution();
testMaintainsRunIdentityForActiveWarmupTask();
testClearsRunIdentityAfterTerminalAck();
testStopImmediatelyInterruptsAndCleansUpBeforeWorkerReturns();
console.log("account warmup command bridge tests passed");
