var assert = require("assert");
var createBridge = require("../app/account-warmup-command-bridge.js").createAccountWarmupCommandBridge;

function createHarness() {
  var acknowledgements = [];
  var events = [];
  var workers = [];
  var registryModule = {
    createAccountWarmupRegistry: function () {
      return { create: function () { return { run: function () { return { status: "TARGET_LIVE_ENTERED" }; } }; } };
    }
  };
  function cleanupModule(source) {
    return { createDouyinPostPublishCleanup: function () {
      return { run: function () { events.push(source); return { completed: true }; } };
    } };
  }
  var context = {
    uploader: {
      pollCommands: function () { return []; },
      ackCommand: function (id, status, result) {
        acknowledgements.push({ id: id, status: status, result: result });
        return { success: true };
      }
    },
    logger: { info: function () {}, warn: function () {}, error: function () {} },
    loadBizScript: function (modulePath) {
      return modulePath === "features/account-warmup/registry.js" ? registryModule : cleanupModule("biz-cleanup");
    },
    loadBaselineScript: function (modulePath) {
      return modulePath === "features/account-warmup/registry.js" ? registryModule : cleanupModule("baseline-cleanup");
    },
    startThread: function (worker) { workers.push(worker); return { interrupt: function () { events.push("interrupt-worker"); } }; }
  };
  return { context: context, acknowledgements: acknowledgements, events: events, workers: workers };
}

function runCommand(id) {
  return { id: id, commandType: "ACCOUNT_WARMUP_RUN", payload: {
    featureKey: "target_live_interaction", batchId: "batch-loader", config: {}
  } };
}

function testStopCleanupPrefersHotUpdatedBusinessCleanup() {
  var harness = createHarness();
  var baselineCalls = 0;
  var originalBaselineLoader = harness.context.loadBaselineScript;
  harness.context.loadBaselineScript = function (modulePath) {
    baselineCalls += 1;
    return originalBaselineLoader(modulePath);
  };
  var bridge = createBridge(harness.context);
  bridge.install();
  bridge.intercept([runCommand("run-hot-cleanup")]);
  bridge.intercept([{ id: "stop-hot-cleanup", commandType: "ACCOUNT_WARMUP_STOP", payload: {
    batchId: "batch-loader", targetCommandId: "run-hot-cleanup"
  } }]);
  assert.strictEqual(baselineCalls, 0);
  assert.deepStrictEqual(harness.events, ["interrupt-worker", "biz-cleanup"]);
  assert.deepStrictEqual(harness.acknowledgements.map(function (ack) { return [ack.id, ack.status]; }),
    [["stop-hot-cleanup", "DONE"], ["run-hot-cleanup", "DONE"]]);
  assert.strictEqual(bridge.getActive(), null);
}

function testFallsBackToBaselineRegistryWhenOverlayIsBroken() {
  var harness = createHarness();
  var baselineLoads = [];
  var originalBaselineLoader = harness.context.loadBaselineScript;
  harness.context.loadBizScript = function () { throw new Error("broken overlay dependency"); };
  harness.context.loadBaselineScript = function (modulePath) {
    baselineLoads.push(modulePath);
    return originalBaselineLoader(modulePath);
  };
  var bridge = createBridge(harness.context);
  bridge.install();
  bridge.intercept([runCommand("run-baseline-registry")]);
  harness.workers[0]();
  assert.deepStrictEqual(baselineLoads, [
    "features/publish-video/douyin-post-publish-cleanup.js", "features/account-warmup/registry.js"
  ]);
  assert.deepStrictEqual(harness.acknowledgements, [{ id: "run-baseline-registry", status: "DONE",
    result: { status: "TARGET_LIVE_ENTERED" } }]);
  assert.strictEqual(bridge.getActive(), null);
}

testStopCleanupPrefersHotUpdatedBusinessCleanup();
testFallsBackToBaselineRegistryWhenOverlayIsBroken();
console.log("account warmup loader fallback tests passed");
