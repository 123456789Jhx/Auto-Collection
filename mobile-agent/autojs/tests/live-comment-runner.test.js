var assert = require("assert");
var fs = require("fs");
var path = require("path");
var createLiveCommentRunner = require("../app/live-comment-runner.js").createLiveCommentRunner;
var riskDetector = require("../domain/risk-detector.js");

function createLogger() {
  return {
    info: function () {},
    warn: function () {},
    error: function () {}
  };
}

function createBaseContext(overrides) {
  var logs = [];
  var checkpoints = [];
  var context = {
    config: {
      schedule: {
        enabled: true,
        liveMinutesMin: 1,
        liveMinutesMax: 1,
        videoMinutesMin: 1,
        videoMinutesMax: 1
      },
      task: {
        liveCommentBotConfig: {
          targetRoom: {
            enabled: true,
            anchorName: "目标主播",
            allowRealSend: false
          }
        },
        liveReadonlyEnabled: true
      },
      runtime: {
        launchFailurePauseThreshold: 3,
        agentIdleLoopMs: 1000,
        riskWords: []
      }
    },
    logger: createLogger(),
    permissions: {},
    uploader: {},
    floatyControl: {
      state: {
        running: true,
        paused: false,
        stopRequested: false,
        exitRequested: false,
        liveCommentControlStatus: ""
      },
      update: function (patch) {
        for (var key in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, key)) {
            this.state[key] = patch[key];
          }
        }
      }
    },
    douyin: {
      openApp: function () { return true; },
      openTargetLiveRoomFromSearch: function () { return true; },
      getLastTargetLiveSearchResult: function () { return { reason: "room_verified" }; },
      extractFastText: function () { return { combinedText: "目标主播 正在直播" }; },
      exitAppToHome: function () { logs.push({ type: "exit" }); return true; }
    },
    counters: {
      viewedCount: 0,
      liveViewedCount: 0,
      liveRoomEnteredCount: 0,
      liveCandidateCount: 0,
      liveRejectedCount: 0,
      capturedCount: 0,
      plannedVideoMinutes: 0,
      plannedLiveMinutes: 0,
      videoElapsedMinutes: 0,
      videoRemainingMinutes: 0,
      liveElapsedMinutes: 0,
      liveRemainingMinutes: 0,
      currentPhase: "",
      phaseStartedAt: "",
      phaseEndedAt: "",
      lastStopReason: ""
    },
    controlLoop: {
      reportRuntimeLog: function (level, message, payload) {
        logs.push({ level: level, message: message, payload: payload });
      },
      refreshRuntimeConfig: function () {},
      waitWhilePaused: function () {},
      pollControlCommandsAsync: function () {}
    },
    heartbeatService: {
      reportImmediateHeartbeat: function () {},
      reportAgentHeartbeat: function () {}
    },
    taskScheduler: {
      activeTaskType: "live_comment",
      resolveTaskType: function (taskType, fallbackTaskType) {
        if (taskType === "live_comment_control") {
          return "live_comment";
        }
        return taskType || fallbackTaskType || "video";
      },
      getActiveTaskType: function () {
        return this.activeTaskType;
      },
      startTask: function (taskType) {
        this.activeTaskType = taskType;
      },
      finishTask: function () {
        this.activeTaskType = "";
      },
      restoreTask: function () { return false; },
      recordCheckpoint: function (taskType, checkpoint) {
        checkpoints.push({ taskType: taskType, checkpoint: checkpoint });
      }
    },
    phaseRunner: {
      calls: [],
      runPhase: function (sceneType, durationMinutes, options) {
        this.calls.push({ sceneType: sceneType, durationMinutes: durationMinutes, options: options });
      }
    },
    liveRoomSampler: {
      sampleCurrentRoom: function () {
        return {
          sampleCount: 1,
          sentActionCount: 0,
          failedActionCount: 0,
          skippedActionCount: 1
        };
      }
    },
    riskDetector: {
      containsRisk: function () { return false; }
    },
    runRequestResolver: {
      resolveRequestedTaskType: function () { return "live_comment"; },
      getLastResolvedSource: function () { return "test"; }
    },
    logs: logs,
    checkpoints: checkpoints
  };
  overrides = overrides || {};
  for (var key in overrides) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      context[key] = overrides[key];
    }
  }
  return context;
}

function testCollectorDoesNotRouteLiveCommentThroughLivePhase() {
  var source = fs.readFileSync(path.join(__dirname, "../app/collector-app.js"), "utf8");
  assert.strictEqual(
    /phaseRunner\.runPhase\(\s*["']live["'][\s\S]*taskType\s*:\s*["']live_comment["']/.test(source),
    false,
    "live_comment must not be routed through ordinary live phase"
  );
  assert.strictEqual(
    /live comment control requested: force target room search flow/.test(source),
    false,
    "live_comment launch flow must not pre-enter target room before independent runner"
  );
}

function testTargetUserLiveEntryPrecedesGenericLiveBadgeCard() {
  var source = fs.readFileSync(path.join(__dirname, "../platforms/douyin.js"), "utf8");
  var start = source.indexOf("function openTargetLiveRoomFromSearch(options)");
  var end = source.indexOf("function clickTargetUserLiveEntryFromSearch", start);
  var body = source.slice(start, end);
  var userEntryIndex = body.indexOf("clickTargetUserLiveEntryFromSearch(");
  var badgeCardIndex = body.indexOf("clickVisibleTargetLiveBadgeCardFromSearch(");

  assert(start >= 0 && end > start, "target live search function must be present");
  assert(userEntryIndex >= 0, "target user live entry must be attempted");
  assert(badgeCardIndex >= 0, "generic live badge card fallback must be attempted");
  assert(
    userEntryIndex < badgeCardIndex,
    "target user live entry should be attempted before generic live badge cards"
  );
}

function testLiveCommentSearchFailureStopsWithReason() {
  var context = createBaseContext();
  context.liveCommentPriorityRequested = true;
  context.liveCommentTargetRoomRefreshRequested = true;
  context.douyin.openTargetLiveRoomFromSearch = function () { return false; };
  context.douyin.getLastTargetLiveSearchResult = function () {
    return { reason: "search_keyword_mismatch" };
  };
  var runner = createLiveCommentRunner(context);

  var result = runner.runTargetLiveCommentTask();

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, "search_keyword_mismatch");
  assert.strictEqual(context.counters.lastStopReason, "search_keyword_mismatch");
  assert.strictEqual(context.liveCommentPriorityRequested, false);
  assert.strictEqual(context.liveCommentTargetRoomRefreshRequested, false);
  assert.strictEqual(context.floatyControl.state.liveCommentControlStatus, "stopped");
}

function testLiveCommentRiskStopsBeforeCommenting() {
  var sampled = false;
  var context = createBaseContext();
  context.riskDetector.containsRisk = function () { return true; };
  context.liveRoomSampler.sampleCurrentRoom = function () {
    sampled = true;
    return {};
  };
  var runner = createLiveCommentRunner(context);

  var result = runner.runTargetLiveCommentTask();

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, "risk_control");
  assert.strictEqual(sampled, false, "risk page must stop before sampling/commenting");
}

function testLiveCommentPauseStopsBeforeSearch() {
  var searched = false;
  var context = createBaseContext();
  context.floatyControl.state.paused = true;
  context.floatyControl.state.liveCommentExecutionEnabled = false;
  context.douyin.openTargetLiveRoomFromSearch = function () {
    searched = true;
    return true;
  };
  var runner = createLiveCommentRunner(context);

  var result = runner.runTargetLiveCommentTask();

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, "manual_pause");
  assert.strictEqual(searched, false, "paused live comment task must not start target room search");
  assert.strictEqual(context.counters.lastStopReason, "manual_pause");
}

function testLiveCommentPauseDuringSearchStopsAsPause() {
  var guardType = "";
  var context = createBaseContext();
  context.douyin.openTargetLiveRoomFromSearch = function (options) {
    guardType = typeof (options && options.shouldStop);
    context.floatyControl.state.paused = true;
    context.floatyControl.state.liveCommentExecutionEnabled = false;
    return false;
  };
  context.douyin.getLastTargetLiveSearchResult = function () {
    return { reason: "target_live_room_search_failed" };
  };
  var runner = createLiveCommentRunner(context);

  var result = runner.runTargetLiveCommentTask();

  assert.strictEqual(guardType, "function", "target live search must receive an interrupt guard");
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, "manual_pause");
  assert.strictEqual(context.counters.lastStopReason, "manual_pause");
}

function testLiveCommentClearsTargetRefreshBeforeSampling() {
  var refreshFlagDuringSample = null;
  var context = createBaseContext();
  context.liveCommentPriorityRequested = true;
  context.liveCommentTargetRoomRefreshRequested = true;
  context.douyin.getLastTargetLiveSearchResult = function () {
    return {
      reason: "room_verified",
      source: "target_user_live_entry",
      keyword: "目标主播",
      targetKeywords: ["目标主播"]
    };
  };
  context.liveRoomSampler.sampleCurrentRoom = function () {
    refreshFlagDuringSample = context.liveCommentTargetRoomRefreshRequested;
    return {
      stopReason: refreshFlagDuringSample ? "target_room_refresh_requested" : "",
      sampleCount: refreshFlagDuringSample ? 0 : 1,
      sentActionCount: 0,
      failedActionCount: 0,
      skippedActionCount: 1
    };
  };
  var runner = createLiveCommentRunner(context);

  var result = runner.runTargetLiveCommentTask();

  assert.strictEqual(result.success, true);
  assert.strictEqual(refreshFlagDuringSample, false, "target room refresh flag must be cleared before sampling");
  assert.strictEqual(result.liveRoomSample.sampleCount, 1);
  assert.strictEqual(context.liveCommentTargetRoomRefreshRequested, false);
  assert.strictEqual(context.targetLiveRoomEntry && context.targetLiveRoomEntry.anchorName, "目标主播");
}

function testLiveCommentSamplesUntilDurationExpires() {
  var originalNow = Date.now;
  var fakeNow = 1000;
  var sampleCalls = 0;
  var context = createBaseContext();
  context.liveRoomSampler.sampleCurrentRoom = function () {
    sampleCalls += 1;
    fakeNow += 35 * 1000;
    return {
      stopReason: "",
      sampleCount: 8,
      sentActionCount: 1,
      failedActionCount: 0,
      skippedActionCount: 0,
      plannedActionCount: 1,
      commentCount: 2
    };
  };
  Date.now = function () {
    return fakeNow;
  };
  try {
    var runner = createLiveCommentRunner(context);
    var result = runner.runTargetLiveCommentTask({ durationMinutes: 1 });

    assert.strictEqual(result.success, true);
    assert(sampleCalls >= 2, "live comment runner should keep sampling until task duration expires");
    assert.strictEqual(result.liveRoomSample.sentActionCount, sampleCalls);
    assert.strictEqual(result.liveRoomSample.sampleCount, sampleCalls * 8);
  } finally {
    Date.now = originalNow;
  }
}

function testLiveCommentDoesNotLoopWhenSamplerDisabled() {
  var originalNow = Date.now;
  var fakeNow = 1000;
  var sampleCalls = 0;
  var context = createBaseContext();
  context.liveRoomSampler.sampleCurrentRoom = function () {
    sampleCalls += 1;
    fakeNow += 35 * 1000;
    return {
      enabled: false,
      sampleCount: 0,
      sentActionCount: 0
    };
  };
  Date.now = function () {
    return fakeNow;
  };
  try {
    var runner = createLiveCommentRunner(context);
    var result = runner.runTargetLiveCommentTask({ durationMinutes: 1 });

    assert.strictEqual(result.success, true);
    assert.strictEqual(sampleCalls, 1, "disabled sampler should not be called repeatedly");
    assert.strictEqual(result.liveRoomSample.enabled, false);
  } finally {
    Date.now = originalNow;
  }
}

function testRiskDetectorCoversObservedDouyinBlockPage() {
  assert.strictEqual(
    riskDetector.containsRisk(
      { runtime: { riskWords: [] } },
      "您的访问被拒绝\n操作过于频繁，请稍后再试，预计12小时后即可正常访问\n也可以通过核验身份立即恢复访问"
    ),
    true
  );
}

testCollectorDoesNotRouteLiveCommentThroughLivePhase();
testTargetUserLiveEntryPrecedesGenericLiveBadgeCard();
testLiveCommentSearchFailureStopsWithReason();
testLiveCommentRiskStopsBeforeCommenting();
testLiveCommentPauseStopsBeforeSearch();
testLiveCommentPauseDuringSearchStopsAsPause();
testLiveCommentClearsTargetRefreshBeforeSampling();
testLiveCommentSamplesUntilDurationExpires();
testLiveCommentDoesNotLoopWhenSamplerDisabled();
testRiskDetectorCoversObservedDouyinBlockPage();

console.log("live-comment-runner tests passed");
