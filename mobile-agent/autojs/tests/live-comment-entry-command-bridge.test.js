var assert = require("assert");
var createBridge = require("../app/account-warmup-command-bridge.js").createAccountWarmupCommandBridge;

function command(id, type, payload) {
  return { id: id, commandType: type, payload: payload || {} };
}

function createHarness(runResult, runScript) {
  var acknowledgements = [];
  var events = [];
  var queuedThreads = [];
  var reportStage = null;
  var uploader = {
    pollCommands: function () { return []; },
    ackCommand: function (id, status, result) {
      acknowledgements.push({ id: id, status: status, result: result });
      return {};
    }
  };
  var context = {
    uploader: uploader,
    logger: { info: function () {}, warn: function () {}, error: function () {} },
    loadBizScript: function () {
      return {
        createAccountWarmupRegistry: function () {
          return {
            create: function (_featureKey, options) {
              reportStage = options.reportStage;
              return { run: function (payload, control) {
                if (runScript) runScript(reportStage, payload, control);
                return runResult || { status: "LIVE_COMMENT_ENTRY_ENTERED" };
              } };
            }
          };
        }
      };
    },
    loadBaselineScript: function () {
      return {
        createDouyinPostPublishCleanup: function () {
          return { run: function () { events.push("legacy-cleanup"); return { completed: true }; } };
        }
      };
    },
    startThread: function (runner) {
      queuedThreads.push(runner);
      return { interrupt: function () { events.push("interrupt-worker"); } };
    }
  };
  return {
    context: context,
    acknowledgements: acknowledgements,
    events: events,
    queuedThreads: queuedThreads,
    getReportStage: function () { return reportStage; }
  };
}

function testReportsOrderedStagesAndCompletesLiveEntry() {
  var harness = createHarness(null, function (reportStage) {
    reportStage({ stage: "OPENING_DOUYIN", attempt: 1 });
    reportStage({ stage: "ENTERED", attempt: 1 });
  });
  var bridge = createBridge(harness.context);
  bridge.install();
  var run = command("run-live-entry", "ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry",
    batchId: "batch-live-entry",
    config: {}
  });

  bridge.intercept([run]);
  harness.queuedThreads[0]();

  assert.deepStrictEqual(harness.acknowledgements.slice(0, 2).map(function (item) {
    return { status: item.status, result: item.result };
  }), [
    {
      status: "RUNNING",
      result: {
        featureKey: "live_comment_entry",
        batchId: "batch-live-entry",
        stage: "OPENING_DOUYIN",
        stageHistory: ["OPENING_DOUYIN"],
        attempt: 1
      }
    },
    {
      status: "RUNNING",
      result: {
        featureKey: "live_comment_entry",
        batchId: "batch-live-entry",
        stage: "ENTERED",
        stageHistory: ["OPENING_DOUYIN", "ENTERED"],
        attempt: 1
      }
    }
  ]);
  assert.strictEqual(harness.acknowledgements[2].status, "DONE");
  assert.strictEqual(harness.acknowledgements[2].result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.strictEqual(harness.acknowledgements[2].result.stage, "ENTERED");
  assert.deepStrictEqual(harness.acknowledgements[2].result.stageHistory, ["OPENING_DOUYIN", "ENTERED"]);
}

function testCapsStageHistoryAtTwentyEntries() {
  var harness = createHarness(null, function (reportStage) {
    for (var index = 1; index <= 21; index++) reportStage({ stage: "STAGE_" + index });
  });
  var bridge = createBridge(harness.context);
  bridge.install();
  var run = command("run-live-history", "ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry",
    batchId: "batch-live-history",
    config: {}
  });
  bridge.intercept([run]);
  harness.queuedThreads[0]();

  var history = harness.acknowledgements[20].result.stageHistory;
  assert.strictEqual(history.length, 20);
  assert.strictEqual(history[0], "STAGE_2");
  assert.strictEqual(history[19], "STAGE_21");
}

function testLiveEntryStopAcknowledgesBothCommandsWithoutLegacyCleanup() {
  var harness = createHarness();
  var bridge = createBridge(harness.context);
  bridge.install();
  var run = command("run-live-stop", "ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry",
    batchId: "batch-live-stop",
    config: {}
  });
  var stop = command("stop-live", "ACCOUNT_WARMUP_STOP", {
    targetCommandId: run.id,
    batchId: "batch-live-stop"
  });

  bridge.intercept([run]);
  bridge.intercept([stop]);

  assert.deepStrictEqual(harness.events, ["interrupt-worker"]);
  assert.strictEqual(harness.acknowledgements[0].id, "stop-live");
  assert.strictEqual(harness.acknowledgements[0].status, "DONE");
  assert.strictEqual(harness.acknowledgements[0].result.status, "LIVE_COMMENT_ENTRY_STOPPED");
  assert.strictEqual(harness.acknowledgements[0].result.targetCommandId, run.id);
  assert.strictEqual(harness.acknowledgements[1].id, run.id);
  assert.strictEqual(harness.acknowledgements[1].result.status, "LIVE_COMMENT_ENTRY_STOPPED");
  assert.strictEqual(harness.acknowledgements[1].result.stage, "STOPPED");
  assert.deepStrictEqual(harness.acknowledgements[1].result.stageHistory, []);
  assert.strictEqual(bridge.getActive(), null);
}

function testNormalizesAWorkerStopResultForLiveEntry() {
  var harness = createHarness({ status: "STOPPED" });
  var bridge = createBridge(harness.context);
  bridge.install();
  bridge.intercept([command("run-live-worker-stop", "ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry",
    batchId: "batch-live-worker-stop",
    config: {}
  })]);
  harness.queuedThreads[0]();
  assert.strictEqual(harness.acknowledgements[0].status, "DONE");
  assert.strictEqual(harness.acknowledgements[0].result.status, "LIVE_COMMENT_ENTRY_STOPPED");
}

testReportsOrderedStagesAndCompletesLiveEntry();
testCapsStageHistoryAtTwentyEntries();
testLiveEntryStopAcknowledgesBothCommandsWithoutLegacyCleanup();
testNormalizesAWorkerStopResultForLiveEntry();
console.log("live comment entry command bridge tests passed");
