var assert = require("assert");
var fs = require("fs");
var path = require("path");
var createLiveCommentRunner = require("../app/live-comment-runner.js").createLiveCommentRunner;
var createLiveRoomSampler = require("../domain/live-room-sampler.js").createLiveRoomSampler;
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
            searchKeywords: ["target-live-keyword"],
            matchKeywords: ["target-live-keyword"]
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
  var userEntryIndex = body.indexOf("hasAccountTargetRoom(targetRoom) && clickTargetUserLiveEntryFromSearch(");
  var badgeCardIndex = body.indexOf("clickVisibleTargetLiveBadgeCardFromSearch(");

  assert(start >= 0 && end > start, "target live search function must be present");
  assert(userEntryIndex >= 0, "account user live entry must only be attempted for account-based legacy rules");
  assert(badgeCardIndex >= 0, "generic live badge card fallback must be attempted");
  assert(
    userEntryIndex < badgeCardIndex,
    "account user live entry should be attempted before generic live badge cards when account rules exist"
  );
}

function testKeywordUserLiveEntryPrecedesGenericLiveBadgeCard() {
  var source = fs.readFileSync(path.join(__dirname, "../platforms/douyin.js"), "utf8");
  var start = source.indexOf("function openTargetLiveRoomFromSearch(options)");
  var end = source.indexOf("function clickTargetUserLiveEntryFromSearch", start);
  var body = source.slice(start, end);
  var keywordUserEntryIndex = body.indexOf("clickKeywordUserLiveEntryFromSearch(");
  var badgeCardIndex = body.indexOf("clickVisibleTargetLiveBadgeCardFromSearch(");

  assert(start >= 0 && end > start, "target live search function must be present");
  assert(keywordUserEntryIndex >= 0, "keyword user live entry must be attempted");
  assert(badgeCardIndex >= 0, "generic live badge card fallback must be attempted");
  assert(
    keywordUserEntryIndex < badgeCardIndex,
    "keyword user live entry should be attempted before generic live badge cards"
  );
}

function testLiveCommentUsesConfiguredSearchKeyword() {
  var searchedKeyword = "";
  var context = createBaseContext();
  context.config.task.liveCommentBotConfig.targetRoom = {
    enabled: true,
    searchKeywords: ["keyword-from-backend"],
    matchKeywords: ["room-match-keyword"]
  };
  context.douyin.openTargetLiveRoomFromSearch = function (options) {
    searchedKeyword = options && options.keyword;
    return true;
  };
  var runner = createLiveCommentRunner(context);

  var result = runner.runTargetLiveCommentTask({ durationMinutes: 0 });

  assert.strictEqual(result.success, true);
  assert.strictEqual(searchedKeyword, "keyword-from-backend");
  assert.deepStrictEqual(context.targetLiveRoomEntry.searchKeywords, ["keyword-from-backend"]);
  assert.deepStrictEqual(context.targetLiveRoomEntry.matchKeywords, ["room-match-keyword"]);
}

function testLiveCommentTriesNextSearchKeywordWhenFirstMisses() {
  var searchedKeywords = [];
  var context = createBaseContext();
  context.config.task.liveCommentBotConfig.targetRoom = {
    enabled: true,
    searchKeywords: ["missing-keyword", "working-keyword"],
    matchKeywords: ["room-match-keyword"]
  };
  context.douyin.openTargetLiveRoomFromSearch = function (options) {
    searchedKeywords.push(options && options.keyword);
    return searchedKeywords.length === 2;
  };
  context.douyin.getLastTargetLiveSearchResult = function () {
    return searchedKeywords.length === 1
      ? { reason: "target_live_card_not_found", keyword: "missing-keyword" }
      : { reason: "room_verified", keyword: "working-keyword" };
  };
  var runner = createLiveCommentRunner(context);

  var result = runner.runTargetLiveCommentTask({ durationMinutes: 0 });

  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(searchedKeywords, ["missing-keyword", "working-keyword"]);
  assert.strictEqual(context.targetLiveRoomEntry.keyword, "working-keyword");
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
  assert.deepStrictEqual(context.targetLiveRoomEntry && context.targetLiveRoomEntry.searchKeywords, ["target-live-keyword"]);
}

function testTargetRoomAllowRealSendDoesNotBypassExecutionGate() {
  var originalSleep = global.sleep;
  var sendCount = 0;
  global.sleep = function () {};
  try {
    var context = {
      config: {
        device: { deviceId: "device-1" },
        task: {
          taskId: "task-1",
          platform: "douyin",
          liveReadonlyEnabled: true,
          liveCommentMode: "agri_chatbot",
          liveCommentRole: "follower",
          liveComment: {
            executeEnabled: false,
            manualExecutionApproved: false
          },
          liveCommentBotConfig: {
            enabled: true,
            templatePools: { question: ["不能发送"] },
            targetRoom: {
              enabled: true,
              allowRealSend: true,
              searchKeywords: ["target-live-keyword"],
              matchKeywords: ["target-live-keyword"],
              maxSendCount: 3,
              minSendIntervalSeconds: 10
            }
          }
        }
      },
      logger: createLogger(),
      floatyControl: {
        state: {
          liveCommentControlStatus: "running",
          liveCommentExecutionEnabled: false
        }
      },
      douyin: {
        extractFastText: function () {
          return {
            combinedText: "target-live-keyword 说点什么 欢迎来到直播间 直播间: target-room",
            currentPackageName: "com.ss.android.ugc.aweme"
          };
        },
        sendLiveComment: function () {
          sendCount += 1;
          return { success: true };
        }
      },
      liveRoomDetector: {
        detect: function () {
          return { state: "live_room", readyForCommentRead: true, reasons: ["test"] };
        }
      },
      liveCommentReader: {
        readFromText: function () {
          return [{ text: "target-live-keyword 用户: 这是什么", raw: "target-live-keyword 用户: 这是什么" }];
        }
      },
      liveCommentClassifier: {
        classifyMany: function () { return []; }
      },
      liveCommentCache: {
        addMany: function (comments) { return comments; },
        size: function () { return 1; }
      },
      liveTriggerDetector: null,
      liveCommentActionPlanner: {
        recordResult: function () {},
        shouldStopForFailures: function () { return false; },
        getState: function () { return {}; }
      },
      liveRoomRelevanceDetector: {
        detect: function () {
          return {
            related: false,
            score: 0,
            threshold: 100,
            matchedKeywords: [],
            negativeKeywords: [],
            reason: "test"
          };
        }
      },
      agriCommentBotPlanner: {
        plan: function () {
          return {
            type: "comment",
            status: "planned",
            triggerEventId: "event-1",
            leaderAccountName: "",
            triggerText: "target-live-keyword",
            matchedKeywords: ["target-live-keyword"],
            confidence: 1,
            replyText: "不能发送",
            plannedDelayMs: 0,
            plannedAt: new Date().toISOString(),
            rawPayload: {}
          };
        }
      },
      storage: {
        appendLiveCommentLog: function () {}
      },
      uploader: {
        uploadLiveCommentAction: function () {}
      },
      controlLoop: {
        waitWhilePaused: function () {},
        pollControlCommandsAsync: function () {}
      }
    };
    var sampler = createLiveRoomSampler(context);

    var result = sampler.sampleCurrentRoom({ maxSamples: 1, sampleIntervalMs: 1 });

    assert.strictEqual(sendCount, 0, "legacy allowRealSend must not bypass unified execution switches");
    assert.strictEqual(result.sentActionCount, 0);
    assert.strictEqual(result.plannedActionCount, 1);
    assert.strictEqual(result.plannedActions[0].status, "planned");
  } finally {
    global.sleep = originalSleep;
  }
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
testKeywordUserLiveEntryPrecedesGenericLiveBadgeCard();
testLiveCommentUsesConfiguredSearchKeyword();
testLiveCommentTriesNextSearchKeywordWhenFirstMisses();
testLiveCommentSearchFailureStopsWithReason();
testLiveCommentRiskStopsBeforeCommenting();
testLiveCommentPauseStopsBeforeSearch();
testLiveCommentPauseDuringSearchStopsAsPause();
testLiveCommentClearsTargetRefreshBeforeSampling();
testTargetRoomAllowRealSendDoesNotBypassExecutionGate();
testLiveCommentSamplesUntilDurationExpires();
testLiveCommentDoesNotLoopWhenSamplerDisabled();
testRiskDetectorCoversObservedDouyinBlockPage();

console.log("live-comment-runner tests passed");
