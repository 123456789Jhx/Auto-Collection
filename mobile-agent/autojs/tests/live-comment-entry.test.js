var assert = require("assert");
var createLiveCommentEntryTask = require("../features/account-warmup/live-comment-entry.js").createLiveCommentEntryTask;

function createRuntime(overrides) {
  var events = [];
  var runtime = {
    openDouyin: function () { events.push("openDouyin"); return true; },
    openSearch: function (keyword) { events.push("openSearch:" + keyword); return true; },
    openLiveTab: function () { events.push("openLiveTab"); return true; },
    openFirstLive: function () { events.push("openFirstLive"); return true; },
    isLiveRoom: function () { events.push("isLiveRoom"); return true; },
    readComments: function () { events.push("readComments"); return { text: "测试用户：测试评论" }; },
    swipeComments: function () { events.push("swipeComments"); return true; },
    waitRandom: function () { events.push("waitRandom"); },
    restartSearch: function () { events.push("restartSearch"); return true; }
  };
  Object.assign(runtime, overrides || {});
  runtime.events = events;
  return runtime;
}

function runTask(runtime, payload, control, stages, taskOverrides) {
  stages = stages || [];
  var taskOptions = {
    runtime: runtime,
    reportStage: function (event) { stages.push(event); }
  };
  Object.assign(taskOptions, taskOverrides || {});
  return createLiveCommentEntryTask(taskOptions)
    .run(payload || { targetKeyword: "药材种植" }, control || { shouldStop: function () { return false; } });
}

function testEntersLiveRoomThroughIndependentStateMachine() {
  var runtime = createRuntime();
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "药材种植" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.strictEqual(result.captureStatus, "LIVE_COMMENT_ENTRY_CAPTURED");
  assert.deepStrictEqual(runtime.events.filter(function (event) {
    return event !== "waitRandom" && event !== "readComments" && event !== "swipeComments";
  }), [
    "openDouyin",
    "openSearch:药材种植",
    "openLiveTab",
    "openFirstLive",
    "isLiveRoom"
  ]);
  assert.deepStrictEqual(stages.slice(0, 6).map(function (event) { return event.stage; }), [
    "OPENING_DOUYIN",
    "OPENING_SEARCH",
    "INPUT_KEYWORD",
    "OPENING_LIVE_TAB",
    "OPENING_FIRST_RESULT",
    "ENTERED"
  ]);
  assert.strictEqual(stages[stages.length - 1].stage, "COMMENTS_CAPTURED");
}

function testRetriesSearchOnlyOnceWhenFirstResultIsMissing() {
  var attempts = 0;
  var runtime = createRuntime({
    openFirstLive: function () {
      attempts += 1;
      return attempts === 2;
    }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.strictEqual(result.captureStatus, "LIVE_COMMENT_ENTRY_CAPTURED");
  assert.strictEqual(attempts, 2);
  assert.strictEqual(runtime.events.filter(function (event) { return event === "restartSearch"; }).length, 1);
  assert.strictEqual(stages.filter(function (event) { return event.stage === "RETRYING_SEARCH"; }).length, 1);
}

function testReportsFailureAfterOneRetry() {
  var runtime = createRuntime({
    openFirstLive: function () { return false; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
  assert.strictEqual(result.failedStage, "OPENING_FIRST_RESULT");
  assert.strictEqual(typeof result.message, "string");
  assert.strictEqual(stages[stages.length - 1].stage, "FAILED");
}

function testDoesNotRetryWhenClickedResultIsNotConfirmedAsLiveRoom() {
  var runtime = createRuntime({
    isLiveRoom: function () { return false; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
  assert.strictEqual(result.failedStage, "OPENING_FIRST_RESULT");
  assert.strictEqual(runtime.events.filter(function (event) { return event === "restartSearch"; }).length, 0);
}

function testClickFailureDoesNotRetrySearch() {
  var restartAttempts = 0;
  var runtime = createRuntime({
    openFirstLive: function () { return { success: false, reason: "CLICK_FAILED" }; },
    restartSearch: function () { restartAttempts += 1; return true; }
  });
  var result = runTask(runtime, { targetKeyword: "关键词" });

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
  assert.strictEqual(result.failedStage, "OPENING_FIRST_RESULT");
  assert.strictEqual(restartAttempts, 0);
}

function testCapturesInitialPageAndFiveSwipes() {
  var reads = 0;
  var swipes = 0;
  var runtime = createRuntime({
    readComments: function () {
      reads += 1;
      return { text: reads === 1 ? "甲：首屏评论" : "乙：第" + reads + "页评论" };
    },
    swipeComments: function () { swipes += 1; return true; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.strictEqual(result.captureStatus, "LIVE_COMMENT_ENTRY_CAPTURED");
  assert.strictEqual(result.captureCompleted, true);
  assert.strictEqual(result.commentSwipeCount, 5);
  assert.strictEqual(result.commentPageCount, 6);
  assert.strictEqual(result.commentCount, 6);
  assert.strictEqual(reads, 6);
  assert.strictEqual(swipes, 5);
  assert.strictEqual(result.comments[0].pageIndex, 0);
  assert.strictEqual(result.comments[0].userName, "甲");
  assert.strictEqual(result.comments[0].commentText, "首屏评论");
  assert.strictEqual(result.comments[5].pageIndex, 5);
  assert.strictEqual(result.comments[5].userName, "乙");
  assert.strictEqual(result.comments[5].commentText, "第6页评论");
  assert.strictEqual(stages.filter(function (event) { return event.stage === "SWIPING_COMMENTS"; }).length, 5);
  assert.strictEqual(stages[stages.length - 1].swipeCount, 5);
  assert.strictEqual(stages[stages.length - 1].pageCount, 6);
  assert.strictEqual(result.captureStopReason, "SWIPE_LIMIT_REACHED");
  assert.strictEqual(stages[stages.length - 1].stage, "COMMENTS_CAPTURED");
}

function testStopsWithCommentSwipeFailure() {
  var swipes = 0;
  var runtime = createRuntime({
    readComments: function () { return { text: "甲：首屏评论" }; },
    swipeComments: function () {
      swipes += 1;
      return { success: false, reason: "GESTURE_FAILED" };
    }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED");
  assert.strictEqual(result.reasonCode, "COMMENT_SWIPE_FAILED");
  assert.strictEqual(result.failedStage, "SWIPING_COMMENTS");
  assert.strictEqual(result.swipeCount, 0);
  assert.strictEqual(result.pageCount, 1);
  assert.strictEqual(swipes, 1);
  assert.strictEqual(stages[stages.length - 1].stage, "FAILED");
}

function testRetriesAnEmptyCommentPageAndStillCapturesSixPages() {
  var reads = 0;
  var swipes = 0;
  var runtime = createRuntime({
    readComments: function () {
      reads += 1;
      return { text: reads < 3 ? "" : "用户：第" + reads + "次读取" };
    },
    swipeComments: function () { swipes += 1; return true; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.strictEqual(result.captureCompleted, true);
  assert.strictEqual(result.commentPageCount, 6);
  assert.strictEqual(reads, 8);
  assert.strictEqual(swipes, 5);
  assert.strictEqual(stages.filter(function (event) { return event.stage === "RETRYING_COMMENT_OCR"; }).length, 2);
}

function testStopsAfterTwoSwipedCommentPagesStayEmpty() {
  var reads = 0;
  var swipes = 0;
  var runtime = createRuntime({
    readComments: function () { reads += 1; return { text: "" }; },
    swipeComments: function () { swipes += 1; return true; }
  });
  var result = runTask(runtime, { targetKeyword: "关键词" });

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED");
  assert.strictEqual(result.reasonCode, "COMMENT_OCR_EMPTY");
  assert.strictEqual(result.commentCount, 0);
  assert.deepStrictEqual(result.comments, []);
  assert.strictEqual(result.swipeCount, 2);
  assert.strictEqual(result.pageCount, 3);
  assert.strictEqual(reads, 9);
  assert.strictEqual(swipes, 2);
}

function testDeduplicatesCommentBodiesAndKeepsScopedSources() {
  var page = 0;
  var payload = {
    targetKeyword: "药材种植",
    batchId: "batch-001",
    minViewerCount: 0
  };
  var runtime = createRuntime({
    readComments: function () {
      page += 1;
      return {
        text: page === 1
          ? "甲：今年行情怎么样\n乙：独立评论"
          : "用户" + page + "：今年 行情怎么样"
      };
    },
    swipeComments: function () { return true; }
  });
  var result = runTask(runtime, payload, null, null, { deviceId: "device-007" });

  assert.strictEqual(result.commentCount, 2);
  assert.strictEqual(result.commentSourceCount, 4);
  assert.strictEqual(result.commentSwipeCount, 2);
  assert.strictEqual(result.commentPageCount, 3);
  assert.strictEqual(result.captureStopReason, "NO_NEW_COMMENTS");
  assert.strictEqual(result.comments[0].batchId, "batch-001");
  assert.strictEqual(result.comments[0].deviceId, "device-007");
  assert.strictEqual(result.comments[0].roomKey, "live-comment:药材种植:candidate:1");
  assert.match(result.comments[0].commentId, /^lc_[0-9a-f]{8}$/);
  assert.strictEqual(result.comments[0].sources.length, 3);
  assert.deepStrictEqual(result.comments[0].sources[2], {
    pageIndex: 2,
    userName: "用户3",
    commentText: "今年行情怎么样"
  });
}

function testNewNormalizedCommentResetsNoNewPageStreak() {
  var reads = 0;
  var swipes = 0;
  var pages = [
    "甲：基础评论",
    "乙：基 础 评论",
    "丙：新增评论",
    "丁：新 增 评论",
    "戊：新增评论"
  ];
  var runtime = createRuntime({
    readComments: function () {
      var text = pages[reads];
      reads += 1;
      return { text: text };
    },
    swipeComments: function () { swipes += 1; return true; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);
  var pageStages = stages.filter(function (event) { return event.stage === "COMMENT_PAGE_CAPTURED"; });
  var completedStage = stages.filter(function (event) { return event.stage === "COMMENTS_CAPTURED"; })[0];

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.strictEqual(result.commentCount, 2);
  assert.strictEqual(result.commentSwipeCount, 4);
  assert.strictEqual(result.commentPageCount, 5);
  assert.strictEqual(result.captureStopReason, "NO_NEW_COMMENTS");
  assert.strictEqual(reads, 5);
  assert.strictEqual(swipes, 4);
  assert.strictEqual(completedStage.swipeCount, 4);
  assert.strictEqual(completedStage.pageCount, 5);
  assert.strictEqual(completedStage.captureStopReason, "NO_NEW_COMMENTS");
  assert.deepStrictEqual(pageStages.map(function (event) { return event.newCommentCount; }), [1, 0, 1, 0, 0]);
  assert.deepStrictEqual(pageStages.map(function (event) {
    return event.consecutiveNoNewPageCount;
  }), [0, 1, 0, 1, 2]);
}

function testStopDuringCapturePreservesPartialCandidatesAndActualStats() {
  var stopRequested = false;
  var runtime = createRuntime({
    readComments: function () {
      stopRequested = true;
      return { text: "甲：停止前已抓取" };
    }
  });
  var result = runTask(runtime, { targetKeyword: "关键词" }, {
    shouldStop: function () { return stopRequested; }
  });

  assert.strictEqual(result.status, "STOPPED");
  assert.strictEqual(result.captureCompleted, false);
  assert.strictEqual(result.commentSwipeCount, 0);
  assert.strictEqual(result.commentPageCount, 1);
  assert.strictEqual(result.commentCount, 1);
  assert.strictEqual(result.commentSourceCount, 1);
  assert.strictEqual(result.comments[0].commentText, "停止前已抓取");
}

function testRunsCleanupAfterCaptureBeforeReturningSuccess() {
  var events = [];
  var runtime = createRuntime({
    readComments: function () { events.push("read"); return { text: "甲：有效评论" }; },
    swipeComments: function () { events.push("swipe"); return true; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词", batchId: "batch-cleanup" }, null, stages, {
    finalCleanup: {
      run: function (payload, lifecycle) {
        events.push("cleanup:" + payload.taskId);
        lifecycle.beforeReturnToAgent();
        return { completed: true };
      }
    }
  });

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.deepStrictEqual(result.cleanup, { completed: true });
  assert.strictEqual(events[events.length - 1], "cleanup:batch-cleanup");
  assert.strictEqual(stages[stages.length - 3].stage, "CLEANING_UP");
  assert.strictEqual(stages[stages.length - 2].stage, "RETURNING_TO_AGENT");
  assert.strictEqual(stages[stages.length - 1].stage, "CLEANUP_COMPLETED");
}

function testCleansUpCaptureFailureWithoutLosingPartialCandidates() {
  var reads = 0;
  var cleanupCalls = 0;
  var runtime = createRuntime({
    readComments: function () {
      reads += 1;
      if (reads === 1) return { text: "甲：已抓到的评论" };
      throw new Error("OCR_ENGINE_FAILED");
    },
    swipeComments: function () { return true; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词", batchId: "batch-partial" }, null, stages, {
    finalCleanup: {
      run: function () { cleanupCalls += 1; return { completed: true }; }
    }
  });

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED");
  assert.strictEqual(result.reasonCode, "COMMENT_OCR_FAILED");
  assert.strictEqual(result.commentCount, 1);
  assert.strictEqual(result.comments[0].commentText, "已抓到的评论");
  assert.strictEqual(cleanupCalls, 1);
  assert.deepStrictEqual(result.cleanup, { completed: true });
  assert.strictEqual(stages[stages.length - 1].stage, "FAILED");
}

function testFailsClearlyWhenCommentOcrCapabilityIsMissing() {
  var cleanupCalls = 0;
  var runtime = createRuntime({ readComments: undefined });
  var result = runTask(runtime, { targetKeyword: "关键词", batchId: "batch-no-ocr" }, null, null, {
    finalCleanup: {
      run: function () { cleanupCalls += 1; return { completed: true }; }
    }
  });

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED");
  assert.strictEqual(result.reasonCode, "COMMENT_OCR_UNAVAILABLE");
  assert.strictEqual(result.failedStage, "CAPTURING_COMMENTS");
  assert.strictEqual(result.commentCount, 0);
  assert.deepStrictEqual(result.comments, []);
  assert.strictEqual(cleanupCalls, 1);
  assert.strictEqual(result.cleanupAttempted, true);
}

function testFailsClearlyWhenCommentSwipeCapabilityIsMissing() {
  var cleanupCalls = 0;
  var runtime = createRuntime({
    readComments: function () { return { text: "甲：首屏已抓取" }; },
    swipeComments: undefined
  });
  var result = runTask(runtime, { targetKeyword: "关键词", batchId: "batch-no-swipe" }, null, null, {
    finalCleanup: {
      run: function () { cleanupCalls += 1; return { completed: true }; }
    }
  });

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED");
  assert.strictEqual(result.reasonCode, "COMMENT_SWIPE_UNAVAILABLE");
  assert.strictEqual(result.failedStage, "SWIPING_COMMENTS");
  assert.strictEqual(result.commentCount, 1);
  assert.strictEqual(result.comments[0].commentText, "首屏已抓取");
  assert.strictEqual(cleanupCalls, 1);
  assert.strictEqual(result.cleanupAttempted, true);
}

function testDoesNotReportSuccessWhenCleanupFails() {
  var runtime = createRuntime({
    readComments: function () { return { text: "甲：有效评论" }; },
    swipeComments: function () { return true; }
  });
  var result = runTask(runtime, { targetKeyword: "关键词", batchId: "batch-cleanup-fail" }, null, null, {
    finalCleanup: { run: function () { return { completed: false, reason: "RECENTS_UNAVAILABLE" }; } }
  });

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_CLEANUP_FAILED");
  assert.strictEqual(result.captureStatus, "LIVE_COMMENT_ENTRY_CAPTURED");
  assert.strictEqual(result.captureCompleted, true);
  assert.strictEqual(result.commentCount, 1);
  assert.strictEqual(result.cleanupAttempted, true);
  assert.strictEqual(result.cleanupRequired, undefined);
}

function testDoesNotReportSuccessWhenDouyinWasNotDismissed() {
  var runtime = createRuntime({
    readComments: function () { return { text: "甲：有效评论" }; },
    swipeComments: function () { return true; }
  });
  var result = runTask(runtime, { targetKeyword: "关键词", batchId: "batch-dismiss-fail" }, null, null, {
    finalCleanup: {
      run: function () {
        return { completed: true, cleanupReason: "DOUYIN_RECENTS_DISMISS_FAILED" };
      }
    }
  });

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_CLEANUP_FAILED");
  assert.strictEqual(result.captureStatus, "LIVE_COMMENT_ENTRY_CAPTURED");
  assert.strictEqual(result.comments[0].commentText, "有效评论");
}

function testDoesNotReportSuccessWhenOnlyReturnedHome() {
  var runtime = createRuntime({
    readComments: function () { return { text: "甲：有效评论" }; },
    swipeComments: function () { return true; }
  });
  var result = runTask(runtime, { targetKeyword: "关键词", batchId: "batch-home-only" }, null, null, {
    finalCleanup: {
      run: function () {
        return { completed: true, fallback: "HOME", reason: "AGENT_RECENTS_CARD_NOT_FOUND" };
      }
    }
  });

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_CLEANUP_FAILED");
  assert.strictEqual(result.captureStatus, "LIVE_COMMENT_ENTRY_CAPTURED");
  assert.strictEqual(result.comments[0].commentText, "有效评论");
}

function testDefaultRuntimeUsesOnlyCommentAreaForEachOcrPage() {
  var originalSleep = global.sleep;
  var originalSwipe = global.swipe;
  var observedRegions = [];
  var observedSwipes = [];
  global.sleep = function () {};
  global.swipe = function (startX, startY, endX, endY, durationMs) {
    observedSwipes.push({ startX: startX, startY: startY, endX: endX, endY: endY, durationMs: durationMs });
    return true;
  };
  try {
    var task = createLiveCommentEntryTask({
      context: {
        config: { device: { deviceId: "device-runtime" } },
        screenSize: function () { return { width: 1080, height: 2248 }; },
        viewerCountParser: { parseViewerBadgeCount: function () { return 356; } },
        screenRecognizer: {
          extractScreen: function (regions) {
            observedRegions.push(regions);
            if (Object.keys(regions)[0] === "commentArea") {
              return { ocrRegions: { commentArea: "甲：评论" }, image: { recycle: function () {} } };
            }
            return { ocrRegions: { liveEndedBanner: "", viewerBadge: "356" } };
          }
        },
        douyin: {
          openApp: function () { return true; },
          openSearch: function () { return true; },
          openLiveTab: function () { return true; },
          openFirstLive: function () { return true; },
          isLiveRoomVisible: function () { return true; }
        },
        riskDetector: {}
      }
    });
    var result = task.run({ targetKeyword: "关键词", minViewerCount: 300, batchId: "batch-runtime" });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
    assert.strictEqual(result.captureStatus, "LIVE_COMMENT_ENTRY_CAPTURED");
    assert.strictEqual(result.comments[0].batchId, "batch-runtime");
    assert.strictEqual(result.comments[0].deviceId, "device-runtime");
    assert.strictEqual(result.commentPageCount, 3);
    assert.strictEqual(result.commentSwipeCount, 2);
    assert.strictEqual(observedRegions.length, 4);
    assert.strictEqual(observedRegions.filter(function (regions) { return Object.keys(regions)[0] === "commentArea"; }).length, 3);
    assert.strictEqual(observedSwipes.length, 2);
    observedRegions.slice(1).forEach(function (regions) {
      assert.deepStrictEqual(Object.keys(regions), ["commentArea"]);
    });
  } finally {
    global.sleep = originalSleep;
    global.swipe = originalSwipe;
  }
}

function testDefaultRuntimeTreatsFalseSwipeAsCaptureFailure() {
  var originalSleep = global.sleep;
  var originalSwipe = global.swipe;
  global.sleep = function () {};
  global.swipe = function () { return false; };
  try {
    var task = createLiveCommentEntryTask({
      context: {
        screenRecognizer: {
          extractScreen: function (regions) {
            if (Object.keys(regions)[0] === "commentArea") {
              return { ocrRegions: { commentArea: "甲：首屏评论" } };
            }
            return { ocrRegions: { liveEndedBanner: "", viewerBadge: "" } };
          }
        },
        douyin: {
          openApp: function () { return true; },
          openSearch: function () { return true; },
          openLiveTab: function () { return true; },
          openFirstLive: function () { return true; },
          isLiveRoomVisible: function () { return true; }
        }
      }
    });
    var result = task.run({ targetKeyword: "关键词", minViewerCount: 0 });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED");
    assert.strictEqual(result.reasonCode, "COMMENT_SWIPE_FAILED");
    assert.strictEqual(result.commentCount, 1);
  } finally {
    global.sleep = originalSleep;
    global.swipe = originalSwipe;
  }
}

function testStopsWithPlatformVerificationWhenValidationAppears() {
  var stages = [];
  var runtime = createRuntime({
    detectPlatformVerification: function (stage) {
      return stage === "OPENING_FIRST_RESULT"
        ? { detected: true, reasonCode: "PLATFORM_VERIFICATION", message: "出现平台验证", textSample: "符合上述描述的图片" }
        : { detected: false };
    }
  });

  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.deepStrictEqual(result, {
    status: "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION",
    reasonCode: "PLATFORM_VERIFICATION",
    message: "出现平台验证",
    failedStage: "OPENING_FIRST_RESULT",
    cleanupRequired: true,
    textSample: "符合上述描述的图片"
  });
  assert.strictEqual(stages[stages.length - 1].stage, "PLATFORM_VERIFICATION");
}

function testStopsAtEveryCommentCaptureVerificationBoundaryAndCleansUpOnce() {
  var cases = [
    { stage: "CAPTURING_COMMENTS", phase: "before", reads: 0, swipes: 0, comments: 0 },
    { stage: "CAPTURING_COMMENTS", phase: "after", reads: 1, swipes: 0, comments: 1 },
    { stage: "SWIPING_COMMENTS", phase: "before", reads: 1, swipes: 0, comments: 1 },
    { stage: "SWIPING_COMMENTS", phase: "after", reads: 1, swipes: 1, comments: 1 }
  ];

  cases.forEach(function (testCase) {
    var reads = 0;
    var swipes = 0;
    var cleanupCalls = 0;
    var stages = [];
    var runtime = createRuntime({
      readComments: function () { reads += 1; return { text: "甲：已抓取评论" }; },
      swipeComments: function () { swipes += 1; return true; },
      detectPlatformVerification: function (stageName, details) {
        var matchesBoundary = stageName === testCase.stage &&
          details && details.phase === testCase.phase && details.pageIndex === 0;
        return matchesBoundary
          ? { detected: true, reasonCode: "PLATFORM_VERIFICATION", textSample: "请完成验证" }
          : { detected: false };
      }
    });
    var result = runTask(runtime, { targetKeyword: "关键词", batchId: "batch-verification" }, null, stages, {
      finalCleanup: {
        run: function () { cleanupCalls += 1; return { completed: true }; }
      }
    });

    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_CAPTURE_PLATFORM_VERIFICATION");
    assert.strictEqual(result.reasonCode, "CAPTURE_PLATFORM_VERIFICATION");
    assert.strictEqual(result.platformVerification, true);
    assert.strictEqual(result.cleanupRequired, false);
    assert.strictEqual(result.cleanupAttempted, true);
    assert.strictEqual(cleanupCalls, 1);
    assert.strictEqual(reads, testCase.reads);
    assert.strictEqual(swipes, testCase.swipes);
    assert.strictEqual(result.swipeCount, testCase.swipes);
    assert.strictEqual(result.commentCount, testCase.comments);
    var verificationStages = stages.filter(function (event) { return event.stage === "PLATFORM_VERIFICATION"; });
    assert.strictEqual(verificationStages.length, 1);
    assert.strictEqual(verificationStages[0].reasonCode, undefined);
    assert.strictEqual(verificationStages[0].phase, testCase.phase);
  });
}

function testKeepsRoomWhenViewerCountMeetsMinimum() {
  var runtime = createRuntime({
    readViewerCount: function () { return { count: 356, textSample: "在线 356 人" }; },
    nextLive: function () { throw new Error("should not switch room"); }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词", minViewerCount: 300 }, null, stages);
  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.strictEqual(result.viewerCount, 356);
  assert.strictEqual(stages.some(function (item) { return item.stage === "VIEWER_COUNT_ACCEPTED"; }), true);
}

function testSkipsLowViewerRoomAndKeepsSearching() {
  var roomIndex = 0;
  var nextCalls = 0;
  var runtime = createRuntime({
    readViewerCount: function () {
      roomIndex += 1;
      return { count: roomIndex === 1 ? 120 : 420, textSample: "在线 " + (roomIndex === 1 ? 120 : 420) + " 人" };
    },
    nextLive: function () { nextCalls += 1; return true; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词", minViewerCount: 300 }, null, stages);
  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.strictEqual(result.viewerCount, 420);
  assert.strictEqual(nextCalls, 1);
  assert.strictEqual(stages.some(function (item) { return item.stage === "SKIPPING_LOW_VIEWER_ROOM"; }), true);
}

function testSkipsEndedRoomBeforeCheckingViewerThreshold() {
  var roomIndex = 0;
  var nextCalls = 0;
  var runtime = createRuntime({
    readViewerCount: function () {
      roomIndex += 1;
      return roomIndex === 1
        ? { ended: true, count: 999, textSample: "999", endedTextSample: "直播 已结束" }
        : { ended: false, count: 420, textSample: "420", endedTextSample: "" };
    },
    nextLive: function () { nextCalls += 1; return true; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词", minViewerCount: 300 }, null, stages);
  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.strictEqual(result.viewerCount, 420);
  assert.strictEqual(nextCalls, 1);
  assert.strictEqual(stages.some(function (item) { return item.stage === "SKIPPING_ENDED_LIVE_ROOM"; }), true);
  assert.strictEqual(stages.some(function (item) { return item.stage === "VIEWER_COUNT_ACCEPTED"; }), true);
}

function testStillSkipsEndedRoomWhenViewerFloorIsDisabled() {
  var roomIndex = 0;
  var nextCalls = 0;
  var runtime = createRuntime({
    readViewerCount: function () {
      roomIndex += 1;
      return roomIndex === 1
        ? { ended: true, endedTextSample: "直播已结束" }
        : { ended: false, count: null, textSample: "" };
    },
    nextLive: function () { nextCalls += 1; return true; }
  });
  var result = runTask(runtime, { targetKeyword: "关键词", minViewerCount: 0 }, null);
  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.strictEqual(nextCalls, 1);
}

function testFailsRedWhenEndedRoomsAreExhausted() {
  var runtime = createRuntime({
    readViewerCount: function () { return { ended: true, count: 888, endedTextSample: "直播已结束" }; },
    nextLive: function () { throw new Error("must not swipe after final candidate"); }
  });
  var stages = [];
  var result = runTask(runtime, {
    targetKeyword: "关键词",
    minViewerCount: 300,
    maxCandidateRooms: 1
  }, null, stages);
  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_LIVE_ENDED_EXHAUSTED");
  assert.strictEqual(result.reasonCode, "LIVE_ROOM_ENDED");
  assert.strictEqual(result.failedStage, "SKIPPING_ENDED_LIVE_ROOM");
  assert.strictEqual(stages[stages.length - 1].stage, "FAILED");
}

function testStopsWithViewerCountReadFailureAfterRetries() {
  var reads = 0;
  var runtime = createRuntime({
    readViewerCount: function () { reads += 1; return { count: null, textSample: "人数区域无法识别" }; }
  });
  var result = runTask(runtime, { targetKeyword: "关键词", minViewerCount: 300 }, null);
  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_VIEWER_COUNT_FAILED");
  assert.strictEqual(result.reasonCode, "VIEWER_COUNT_READ_FAILED");
  assert.strictEqual(reads, 3);
}

function testDefaultRuntimeReadsViewerCountOnlyFromViewerBadgeRegion() {
  var originalSleep = global.sleep;
  var recycled = 0;
  global.sleep = function () {};
  try {
    var task = createLiveCommentEntryTask({
      context: {
        viewerCountParser: {
          parseViewerBadgeCount: function (text) { return text.trim() === "356" ? 356 : null; }
        },
        screenSize: function () { return { width: 1080, height: 2248 }; },
        screenRecognizer: {
          extractScreen: function (regions) {
            assert.deepStrictEqual(Object.keys(regions), ["liveEndedBanner", "viewerBadge"]);
            assert.strictEqual(regions.liveEndedBanner.x, 345);
            assert.strictEqual(regions.liveEndedBanner.y, 134);
            assert.strictEqual(regions.liveEndedBanner.w, 411);
            assert.strictEqual(regions.liveEndedBanner.h, 124);
            assert.strictEqual(regions.viewerBadge.x, 642);
            assert.strictEqual(regions.viewerBadge.y, 134);
            assert.strictEqual(regions.viewerBadge.w, 346);
            assert.strictEqual(regions.viewerBadge.h, 129);
            return {
              ocrRegions: { liveEndedBanner: "", viewerBadge: "356" },
              ocrText: "评论 9999 人",
              visibleText: "商品 88 元",
              combinedText: "评论 9999 人 商品 88 元",
              image: { recycle: function () { recycled += 1; } }
            };
          }
        },
        douyin: {
          openApp: function () { return true; },
          openSearch: function () { return true; },
          openLiveTab: function () { return true; },
          openFirstLive: function () { return true; },
          isLiveRoomVisible: function () { return true; }
        },
        riskDetector: {}
      }
    });
    var result = task.run({ targetKeyword: "关键词", minViewerCount: 300 });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED");
    assert.strictEqual(result.reasonCode, "COMMENT_OCR_UNAVAILABLE");
    assert.strictEqual(result.viewerCount, 356);
    assert.strictEqual(recycled, 1);
  } finally {
    global.sleep = originalSleep;
  }
}

function testDefaultRuntimeReadsViewerCountFromTopRightFallbackRegion() {
  var originalSleep = global.sleep;
  global.sleep = function () {};
  try {
    var task = createLiveCommentEntryTask({
      context: {
        viewerCountParser: {
          parseViewerCount: function () { return null; },
          parseViewerBadgeCount: function (text) { return text.trim() === "18" ? 18 : null; }
        },
        screenRecognizer: {
          extractScreen: function (regions) {
            assert.deepStrictEqual(Object.keys(regions), ["liveEndedBanner", "viewerBadge"]);
            return {
              ocrRegions: {
                liveEndedBanner: "",
                viewerBadge: "18"
              },
              ocrText: "",
              combinedText: ""
            };
          }
        },
        douyin: {
          openApp: function () { return true; },
          openSearch: function () { return true; },
          openLiveTab: function () { return true; },
          openFirstLive: function () { return true; },
          isLiveRoomVisible: function () { return true; }
        },
        riskDetector: {}
      }
    });
    var result = task.run({ targetKeyword: "关键词", minViewerCount: 6 });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED");
    assert.strictEqual(result.reasonCode, "COMMENT_OCR_UNAVAILABLE");
    assert.strictEqual(result.viewerCount, 18);
  } finally {
    global.sleep = originalSleep;
  }
}

function testDefaultRuntimeDetectsEndedBannerFromDedicatedRegion() {
  var originalSleep = global.sleep;
  global.sleep = function () {};
  try {
    var task = createLiveCommentEntryTask({
      context: {
        viewerCountParser: {
          parseViewerBadgeCount: function () { return 999; }
        },
        screenSize: function () { return { width: 1080, height: 2248 }; },
        screenRecognizer: {
          extractScreen: function (regions) {
            assert.deepStrictEqual(Object.keys(regions), ["liveEndedBanner", "viewerBadge"]);
            return {
              ocrRegions: { liveEndedBanner: "直播\n已结束", viewerBadge: "999" },
              ocrText: "",
              visibleText: "",
              combinedText: ""
            };
          }
        },
        douyin: {
          openApp: function () { return true; },
          openSearch: function () { return true; },
          openLiveTab: function () { return true; },
          openFirstLive: function () { return true; },
          isLiveRoomVisible: function () { throw new Error("ended overlay must be handled before live-room gate"); },
          nextVideo: function () { return true; }
        },
        riskDetector: {}
      }
    });
    var result = task.run({ targetKeyword: "关键词", minViewerCount: 0, maxCandidateRooms: 1 });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_LIVE_ENDED_EXHAUSTED");
    assert.strictEqual(result.reasonCode, "LIVE_ROOM_ENDED");
  } finally {
    global.sleep = originalSleep;
  }
}

function testDefaultRuntimeReportsNoResultWhenFirstLiveProbeFindsNothing() {
  var originalClick = global.click;
  var originalSleep = global.sleep;
  var clickAttempts = 0;
  global.click = function () { clickAttempts += 1; return true; };
  global.sleep = function () {};
  try {
    var task = createLiveCommentEntryTask({
      context: {
        douyin: {
          openApp: function () { return true; },
          openLiveTab: function () { return true; },
          findFirstLive: function () { return null; },
          isLiveRoomVisible: function () { return true; }
        }
      },
      fastSearch: { openSearch: function () { return true; } }
    });
    var result = task.run({ targetKeyword: "关键词" });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
    assert.strictEqual(result.failedStage, "OPENING_FIRST_RESULT");
    assert.strictEqual(clickAttempts, 0);
  } finally {
    global.click = originalClick;
    global.sleep = originalSleep;
  }
}

function testStopsBeforeOpeningWhenControlRequestsStop() {
  var runtime = createRuntime();
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, { shouldStop: function () { return true; } }, stages);

  assert.deepStrictEqual(result, { status: "STOPPED" });
  assert.deepStrictEqual(runtime.events, []);
  assert.strictEqual(stages.length, 0);
}

function testDefaultRuntimeUsesCurrentScreenSizeForFirstLiveCard() {
  var originalDevice = global.device;
  var originalClick = global.click;
  var originalSleep = global.sleep;
  var clicked = null;
  global.device = { width: 1080, height: 2248 };
  global.click = function (x, y) { clicked = [x, y]; return true; };
  global.sleep = function () {};
  try {
    var task = createLiveCommentEntryTask({
      context: {
        douyin: {
          openApp: function () { return true; },
          openLiveTab: function () { return true; },
          isLiveRoomVisible: function () { return true; }
        }
      },
      fastSearch: { openSearch: function () { return { success: true }; } }
    });

    var result = task.run({ targetKeyword: "关键词" });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED");
    assert.strictEqual(result.reasonCode, "COMMENT_OCR_UNAVAILABLE");
    assert.deepStrictEqual(clicked, [Math.floor(1080 * 0.36), Math.floor(2248 * 0.35)]);
  } finally {
    global.device = originalDevice;
    global.click = originalClick;
    global.sleep = originalSleep;
  }
}

function testRetriesOnceWhenFastSearchHasNoResults() {
  var searchAttempts = 0;
  var restartAttempts = 0;
  var runtime = createRuntime({
    openSearch: function () {
      searchAttempts += 1;
      return { success: false, stage: "result_wait" };
    },
    restartSearch: function () {
      restartAttempts += 1;
      return { success: true };
    }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.strictEqual(result.captureStatus, "LIVE_COMMENT_ENTRY_CAPTURED");
  assert.strictEqual(searchAttempts, 1);
  assert.strictEqual(restartAttempts, 1);
  assert.strictEqual(stages.filter(function (event) { return event.stage === "RETRYING_SEARCH"; }).length, 1);
}

function testFailsClearlyWhenSearchRetryStillHasNoResults() {
  var runtime = createRuntime({
    openSearch: function () { return { success: false, stage: "result_wait" }; },
    restartSearch: function () { return { success: false, stage: "result_wait" }; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
  assert.strictEqual(result.failedStage, "OPENING_SEARCH");
  assert.strictEqual(typeof result.message, "string");
  assert.strictEqual(stages.filter(function (event) { return event.stage === "RETRYING_SEARCH"; }).length, 1);
  assert.strictEqual(stages[stages.length - 1].stage, "FAILED");
}

function testDefaultRetryPrefersFastSearchOverDouyinFallback() {
  var fastSearchAttempts = 0;
  var douyinSearchAttempts = 0;
  var task = createLiveCommentEntryTask({
    context: {
      douyin: {
        openApp: function () { return true; },
        openSearch: function () { douyinSearchAttempts += 1; return true; },
        openLiveTab: function () { return true; },
        openFirstLive: function () { return true; },
        isLiveRoomVisible: function () { return true; }
      }
    },
    fastSearch: {
      openSearch: function () {
        fastSearchAttempts += 1;
        return fastSearchAttempts === 1
          ? { success: false, stage: "result_wait" }
          : { success: true };
      }
    }
  });

  var result = task.run({ targetKeyword: "关键词" });
  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED");
  assert.strictEqual(result.reasonCode, "COMMENT_OCR_UNAVAILABLE");
  assert.strictEqual(fastSearchAttempts, 2);
  assert.strictEqual(douyinSearchAttempts, 0);
}

function testDefaultLiveTabFallbackTreatsFalseClickAsFailure() {
  var originalText = global.text;
  var originalClick = global.click;
  var originalSleep = global.sleep;
  global.text = function () {
    return { findOne: function () { return { click: function () { return false; } }; } };
  };
  global.click = function () { return false; };
  global.sleep = function () {};
  try {
    var task = createLiveCommentEntryTask({
      context: {
        douyin: {
          openApp: function () { return true; },
          isLiveRoomVisible: function () { return true; }
        }
      },
      fastSearch: { openSearch: function () { return true; } }
    });
    var result = task.run({ targetKeyword: "关键词" });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
    assert.strictEqual(result.failedStage, "OPENING_LIVE_TAB");
  } finally {
    global.text = originalText;
    global.click = originalClick;
    global.sleep = originalSleep;
  }
}

function testDefaultLiveTabFallbackIgnoresNodeBelowTopRegion() {
  var originalText = global.text;
  var originalClick = global.click;
  var originalSleep = global.sleep;
  var clickAttempts = 0;
  global.text = function () {
    var wrongNode = {
      bounds: function () {
        return { centerY: function () { return 1000; }, centerX: function () { return 300; } };
      },
      clickable: function () { return true; },
      click: function () { clickAttempts += 1; return true; }
    };
    return {
      find: function () { return [wrongNode]; },
      findOne: function () { return wrongNode; }
    };
  };
  global.click = function () { clickAttempts += 1; return true; };
  global.sleep = function () {};
  try {
    var task = createLiveCommentEntryTask({
      context: { douyin: { openApp: function () { return true; }, isLiveRoomVisible: function () { return true; } } },
      fastSearch: { openSearch: function () { return true; } }
    });
    var result = task.run({ targetKeyword: "关键词" });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
    assert.strictEqual(result.failedStage, "OPENING_LIVE_TAB");
    assert.strictEqual(clickAttempts, 0);
  } finally {
    global.text = originalText;
    global.click = originalClick;
    global.sleep = originalSleep;
  }
}

testEntersLiveRoomThroughIndependentStateMachine();
testRetriesSearchOnlyOnceWhenFirstResultIsMissing();
testReportsFailureAfterOneRetry();
testDoesNotRetryWhenClickedResultIsNotConfirmedAsLiveRoom();
testClickFailureDoesNotRetrySearch();
testCapturesInitialPageAndFiveSwipes();
testStopsWithCommentSwipeFailure();
testRetriesAnEmptyCommentPageAndStillCapturesSixPages();
testStopsAfterTwoSwipedCommentPagesStayEmpty();
testDeduplicatesCommentBodiesAndKeepsScopedSources();
testNewNormalizedCommentResetsNoNewPageStreak();
testStopDuringCapturePreservesPartialCandidatesAndActualStats();
testRunsCleanupAfterCaptureBeforeReturningSuccess();
testCleansUpCaptureFailureWithoutLosingPartialCandidates();
testFailsClearlyWhenCommentOcrCapabilityIsMissing();
testFailsClearlyWhenCommentSwipeCapabilityIsMissing();
testDoesNotReportSuccessWhenCleanupFails();
testDoesNotReportSuccessWhenDouyinWasNotDismissed();
testDoesNotReportSuccessWhenOnlyReturnedHome();
testDefaultRuntimeUsesOnlyCommentAreaForEachOcrPage();
testDefaultRuntimeTreatsFalseSwipeAsCaptureFailure();
testStopsWithPlatformVerificationWhenValidationAppears();
testStopsAtEveryCommentCaptureVerificationBoundaryAndCleansUpOnce();
testKeepsRoomWhenViewerCountMeetsMinimum();
testSkipsLowViewerRoomAndKeepsSearching();
testSkipsEndedRoomBeforeCheckingViewerThreshold();
testStillSkipsEndedRoomWhenViewerFloorIsDisabled();
testFailsRedWhenEndedRoomsAreExhausted();
testStopsWithViewerCountReadFailureAfterRetries();
testDefaultRuntimeReadsViewerCountOnlyFromViewerBadgeRegion();
testDefaultRuntimeReadsViewerCountFromTopRightFallbackRegion();
testDefaultRuntimeDetectsEndedBannerFromDedicatedRegion();
testDefaultRuntimeReportsNoResultWhenFirstLiveProbeFindsNothing();
testStopsBeforeOpeningWhenControlRequestsStop();
testDefaultRuntimeUsesCurrentScreenSizeForFirstLiveCard();
testRetriesOnceWhenFastSearchHasNoResults();
testFailsClearlyWhenSearchRetryStillHasNoResults();
testDefaultRetryPrefersFastSearchOverDouyinFallback();
testDefaultLiveTabFallbackTreatsFalseClickAsFailure();
testDefaultLiveTabFallbackIgnoresNodeBelowTopRegion();
console.log("live comment entry tests passed");
