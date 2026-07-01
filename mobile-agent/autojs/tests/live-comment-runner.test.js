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
testLiveCommentSearchFailureStopsWithReason();
testLiveCommentRiskStopsBeforeCommenting();
testRiskDetectorCoversObservedDouyinBlockPage();

console.log("live-comment-runner tests passed");
