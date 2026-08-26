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

function testLiveEntryStopInterruptsThenRunsCleanupExactlyOnce() {
  var harness = createHarness({
    status: "LIVE_COMMENT_ENTRY_VIEWER_COUNT_FAILED",
    reasonCode: "VIEWER_COUNT_READ_FAILED",
    cleanupRequired: true
  });
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

  assert.deepStrictEqual(harness.events, ["interrupt-worker", "legacy-cleanup"]);
  assert.strictEqual(harness.acknowledgements[0].id, "stop-live");
  assert.strictEqual(harness.acknowledgements[0].status, "DONE");
  assert.strictEqual(harness.acknowledgements[0].result.status, "LIVE_COMMENT_ENTRY_STOPPED");
  assert.strictEqual(harness.acknowledgements[0].result.targetCommandId, run.id);
  assert.deepStrictEqual(harness.acknowledgements[0].result.cleanup, { completed: true });
  assert.strictEqual(harness.acknowledgements[1].id, run.id);
  assert.strictEqual(harness.acknowledgements[1].result.status, "LIVE_COMMENT_ENTRY_STOPPED");
  assert.strictEqual(harness.acknowledgements[1].result.stage, "STOPPED");
  assert.deepStrictEqual(harness.acknowledgements[1].result.cleanup, { completed: true });
  assert.deepStrictEqual(harness.acknowledgements[1].result.stageHistory, []);
  assert.strictEqual(bridge.getActive(), null);

  // The interrupted worker may still unwind and return a cleanup-required result.
  harness.queuedThreads[0]();
  assert.deepStrictEqual(harness.events, ["interrupt-worker", "legacy-cleanup"]);
  assert.strictEqual(harness.acknowledgements.length, 2);
}

function testLiveEntryStopPreservesPartialCandidatesFromLatestProgress() {
  var bridge = null;
  var stop = null;
  var harness = createHarness(null, function (reportStage) {
    reportStage({
      stage: "COMMENT_PAGE_CAPTURED",
      pageIndex: 0,
      commentCount: 1,
      comments: [{ commentId: "lc_1", commentText: "已抓到的评论", userName: "甲" }]
    });
    // A later stage omits comments; the bridge must still retain the last list.
    reportStage({ stage: "SWIPING_COMMENTS", swipeIndex: 1 });
    bridge.intercept([stop]);
  });
  bridge = createBridge(harness.context);
  bridge.install();
  var run = command("run-live-partial-stop", "ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry",
    batchId: "batch-live-partial-stop",
    config: {}
  });
  stop = command("stop-live-partial", "ACCOUNT_WARMUP_STOP", {
    targetCommandId: run.id,
    batchId: "batch-live-partial-stop"
  });

  bridge.intercept([run]);
  harness.queuedThreads[0]();

  var stopAck = harness.acknowledgements.find(function (item) { return item.id === stop.id; });
  var runAck = harness.acknowledgements.find(function (item) { return item.id === run.id && item.status === "DONE"; });
  assert.deepStrictEqual(stopAck.result.comments, [
    { commentId: "lc_1", commentText: "已抓到的评论", userName: "甲" }
  ]);
  assert.strictEqual(stopAck.result.commentCount, 1);
  assert.strictEqual(stopAck.result.captureCompleted, false);
  assert.deepStrictEqual(runAck.result.comments, [
    { commentId: "lc_1", commentText: "已抓到的评论", userName: "甲" }
  ]);
  assert.strictEqual(runAck.result.captureStatus, "LIVE_COMMENT_ENTRY_PARTIAL");
  assert.strictEqual(runAck.result.status, "LIVE_COMMENT_ENTRY_STOPPED");
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

function testCompletesCapturedCommentsAsDoneAndPreservesCandidates() {
  var harness = createHarness({
    status: "LIVE_COMMENT_ENTRY_CAPTURED",
    commentSwipeCount: 5,
    commentCount: 1,
    comments: [{ pageIndex: 0, userName: "甲", commentText: "你好" }]
  });
  var bridge = createBridge(harness.context);
  bridge.install();
  bridge.intercept([command("run-live-captured", "ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry",
    batchId: "batch-live-captured",
    config: {}
  })]);
  harness.queuedThreads[0]();

  assert.strictEqual(harness.acknowledgements[0].status, "DONE");
  assert.strictEqual(harness.acknowledgements[0].result.status, "LIVE_COMMENT_ENTRY_CAPTURED");
  assert.deepStrictEqual(harness.acknowledgements[0].result.comments, [
    { pageIndex: 0, userName: "甲", commentText: "你好" }
  ]);
}

function testPlatformVerificationFailsAndRunsLegacyCleanup() {
  var harness = createHarness({
    status: "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION",
    reasonCode: "PLATFORM_VERIFICATION",
    message: "出现平台验证",
    failedStage: "OPENING_FIRST_RESULT",
    cleanupRequired: true
  });
  var bridge = createBridge(harness.context);
  bridge.install();
  bridge.intercept([command("run-live-verification", "ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry",
    batchId: "batch-live-verification",
    config: {}
  })]);
  harness.queuedThreads[0]();

  assert.deepStrictEqual(harness.events, ["legacy-cleanup"]);
  assert.strictEqual(harness.acknowledgements[0].status, "FAILED");
  assert.strictEqual(harness.acknowledgements[0].result.reasonCode, "PLATFORM_VERIFICATION");
  assert.deepStrictEqual(harness.acknowledgements[0].result.cleanup, { completed: true });
}

function testViewerCountFailureFailsAndRunsLegacyCleanup() {
  var harness = createHarness({
    status: "LIVE_COMMENT_ENTRY_VIEWER_COUNT_FAILED",
    reasonCode: "VIEWER_COUNT_READ_FAILED",
    message: "无法识别直播间人数，脚本已停止",
    cleanupRequired: true
  });
  var bridge = createBridge(harness.context);
  bridge.install();
  bridge.intercept([command("run-live-viewer-failure", "ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry",
    batchId: "batch-live-viewer-failure",
    config: {}
  })]);
  harness.queuedThreads[0]();

  assert.deepStrictEqual(harness.events, ["legacy-cleanup"]);
  assert.strictEqual(harness.acknowledgements[0].status, "FAILED");
  assert.strictEqual(harness.acknowledgements[0].result.reasonCode, "VIEWER_COUNT_READ_FAILED");
  assert.deepStrictEqual(harness.acknowledgements[0].result.cleanup, { completed: true });
}

function testStopCleanupPrefersHotUpdatedBusinessCleanup() {
  var harness = createHarness({
    status: "LIVE_COMMENT_ENTRY_VIEWER_COUNT_FAILED",
    reasonCode: "VIEWER_COUNT_READ_FAILED",
    message: "无法识别直播间人数，脚本已停止",
    cleanupRequired: true
  });
  var baselineCalls = 0;
  var bizCleanupCalls = 0;
  var originalBizLoader = harness.context.loadBizScript;
  harness.context.loadBizScript = function (path) {
    if (path === "features/publish-video/douyin-post-publish-cleanup.js") {
      bizCleanupCalls += 1;
      return {
        createDouyinPostPublishCleanup: function () {
          return { run: function () { harness.events.push("biz-cleanup"); return { completed: true }; } };
        }
      };
    }
    return originalBizLoader(path);
  };
  var originalBaselineLoader = harness.context.loadBaselineScript;
  harness.context.loadBaselineScript = function (path) {
    baselineCalls += 1;
    return originalBaselineLoader(path);
  };
  var bridge = createBridge(harness.context);
  bridge.install();
  bridge.intercept([command("run-live-hot-cleanup", "ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry",
    batchId: "batch-live-hot-cleanup",
    config: {}
  })]);
  harness.queuedThreads[0]();

  assert.strictEqual(bizCleanupCalls, 1);
  assert.strictEqual(baselineCalls, 0);
  assert.deepStrictEqual(harness.events, ["biz-cleanup"]);
}

testReportsOrderedStagesAndCompletesLiveEntry();
testCapsStageHistoryAtTwentyEntries();
testLiveEntryStopInterruptsThenRunsCleanupExactlyOnce();
testLiveEntryStopPreservesPartialCandidatesFromLatestProgress();
testNormalizesAWorkerStopResultForLiveEntry();
testCompletesCapturedCommentsAsDoneAndPreservesCandidates();
testPlatformVerificationFailsAndRunsLegacyCleanup();
testViewerCountFailureFailsAndRunsLegacyCleanup();
testStopCleanupPrefersHotUpdatedBusinessCleanup();

function testFallsBackToBaselineRegistryWhenOverlayIsBroken() {
  var harness = createHarness({ status: "LIVE_COMMENT_ENTRY_ENTERED" });
  var baselineLoads = 0;
  harness.context.loadBizScript = function () {
    throw new Error("overlay registry has a broken relative dependency");
  };
  harness.context.loadBaselineScript = function (path) {
    if (path === "features/account-warmup/registry.js") {
      baselineLoads += 1;
      return {
        createAccountWarmupRegistry: function () {
          return {
            create: function () {
              return { run: function () { return { status: "LIVE_COMMENT_ENTRY_ENTERED" }; } };
            }
          };
        }
      };
    }
    return { createDouyinPostPublishCleanup: function () { return { run: function () { return { completed: true }; } }; } };
  };
  var bridge = createBridge(harness.context);
  bridge.install();
  bridge.intercept([command("run-baseline-registry", "ACCOUNT_WARMUP_RUN", {
    featureKey: "live_comment_entry", batchId: "batch-baseline-registry", config: {}
  })]);
  harness.queuedThreads[0]();
  assert.strictEqual(baselineLoads, 1);
  assert.strictEqual(harness.acknowledgements[harness.acknowledgements.length - 1].status, "DONE");
}

testFallsBackToBaselineRegistryWhenOverlayIsBroken();
console.log("live comment entry command bridge tests passed");
