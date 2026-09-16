"use strict";
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var runnerModule = require("../features/new-comment/comment-runner.js");
var createTiming = require("../features/new-comment/action-timing.js").createActionTiming;
var createTimedRuntime = require("../features/new-comment/timed-runtime-actions.js").createTimedRuntimeActions;
var SCOPE = { batchId: "batch-1", deviceId: "device-1", roomKey: "room-1" };
function copy(target, source) {
  Object.keys(source || {}).forEach(function (key) { target[key] = source[key]; });
  return target;
}
function runIsolated(runtime, optionOverrides, control) {
  var events = [];
  var options = copy({
    runtime: runtime,
    reportStage: function (event) { events.push(event); }
  }, optionOverrides);
  var result = runnerModule.createCommentCaptureRunner(options).capture(SCOPE, control);
  return { result: result, events: events };
}
test("six OCR pages preserve scoped comments and report capture progress before completion", function () {
  var reads = 0;
  var run = runIsolated({
    readComments: function () { reads += 1; return { text: "评论" + reads }; },
    swipeComments: function () { return true; },
    waitRandom: function () {}
  }, { now: function () { return 1000; } });
  assert.deepEqual([run.result.status, run.result.captureStatus, run.result.captureCompleted,
    run.result.commentSwipeCount, run.result.commentPageCount, run.result.commentCount,
    run.result.commentSourceCount, run.result.captureStopReason, run.result.captureElapsedMs],
  ["LIVE_COMMENT_ENTRY_ENTERED", "LIVE_COMMENT_ENTRY_CAPTURED", true, 5, 6, 6, 6, "SWIPE_LIMIT_REACHED", 0]);
  assert.deepEqual(run.result.comments.map(function (comment) { return comment.commentText; }),
    ["评论1", "评论2", "评论3", "评论4", "评论5", "评论6"]);
  assert.equal(new Set(run.result.comments.map(function (comment) { return comment.commentId; })).size, 6);
  run.result.comments.forEach(function (comment, index) {
    assert.deepEqual([comment.batchId, comment.deviceId, comment.roomKey, comment.pageIndex],
      ["batch-1", "device-1", "room-1", index]);
    assert.deepEqual(comment.sources, [{ deviceId: "device-1", roomKey: "room-1",
      pageIndex: index, commentText: "评论" + (index + 1) }]);
    assert.equal(Object.prototype.hasOwnProperty.call(comment, "userName"), false);
  });
  assert.deepEqual(run.events.map(function (event) { return event.stage; }), [
    "CAPTURING_COMMENTS", "COMMENT_PAGE_CAPTURED", "SWIPING_COMMENTS",
    "CAPTURING_COMMENTS", "COMMENT_PAGE_CAPTURED", "SWIPING_COMMENTS",
    "CAPTURING_COMMENTS", "COMMENT_PAGE_CAPTURED", "SWIPING_COMMENTS",
    "CAPTURING_COMMENTS", "COMMENT_PAGE_CAPTURED", "SWIPING_COMMENTS",
    "CAPTURING_COMMENTS", "COMMENT_PAGE_CAPTURED", "SWIPING_COMMENTS",
    "CAPTURING_COMMENTS", "COMMENT_PAGE_CAPTURED", "COMMENTS_CAPTURED"
  ]);
  assert.deepEqual(run.events.filter(function (event) { return event.stage === "COMMENT_PAGE_CAPTURED"; })
    .map(function (event) { return [event.pageIndex, event.commentCount, event.captureCompleted]; }),
  [[0, 1, false], [1, 2, false], [2, 3, false], [3, 4, false], [4, 5, false], [5, 6, false]]);
  assert.equal(run.events[run.events.length - 1].captureCompleted, true);
  assert.deepEqual(run.events[run.events.length - 1].comments, run.result.comments);
});
test("empty OCR retries up to the third attempt before continuing through five swipes", function () {
  var reads = 0;
  var swipes = 0;
  var run = runIsolated({
    readComments: function () {
      reads += 1;
      return { text: reads < 3 ? "" : "第" + reads + "次读取" };
    },
    swipeComments: function () { swipes += 1; return true; },
    waitRandom: function () {}
  });
  assert.deepEqual([run.result.status, reads, swipes], ["LIVE_COMMENT_ENTRY_ENTERED", 8, 5]);
  assert.deepEqual(run.events.filter(function (event) {
    return event.stage === "CAPTURING_COMMENTS" && event.pageIndex === 0;
  }).map(function (event) { return event.ocrAttempt; }), [1, 2, 3]);
  assert.equal(run.events.filter(function (event) {
    return event.stage === "RETRYING_COMMENT_OCR";
  }).length, 2);
});
test("duplicate pages remain captured up to the swipe limit without a history-end banner", function () {
  var page = 0;
  var run = runIsolated({
    readComments: function () {
      page += 1;
      return { text: "相 同 评论" };
    },
    swipeComments: function () { return true; },
    waitRandom: function () {}
  });
  assert.deepEqual([
    run.result.status, run.result.captureStopReason, run.result.commentSwipeCount, run.result.commentPageCount
  ], ["LIVE_COMMENT_ENTRY_ENTERED", "SWIPE_LIMIT_REACHED", 5, 6]);
  assert.deepEqual([run.result.commentCount, run.result.commentSourceCount,
    run.result.comments[0].sources.length], [6, 6, 1]);
});
test("OCR exceptions exhaust three attempts and preserve prior-page candidates", function () {
  var reads = 0;
  var run = runIsolated({
    readComments: function () {
      reads += 1;
      if (reads === 1) return { text: "已抓到的评论" };
      throw new Error("OCR_ENGINE_FAILED");
    },
    swipeComments: function () { return true; },
    waitRandom: function () {}
  });
  assert.deepEqual([reads, run.result.status, run.result.failedStage, run.result.reasonCode,
    run.result.commentCount], [4, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED",
    "CAPTURING_COMMENTS", "COMMENT_OCR_FAILED", 1]);
  assert.equal(run.result.comments[0].commentText, "已抓到的评论");
});
test("missing OCR and swipe capabilities return failure payloads with partial data", function () {
  var noOcr = runIsolated({ swipeComments: function () { return true; } }).result;
  var noSwipe = runIsolated({ readComments: function () { return { text: "首屏评论" }; } }).result;
  assert.deepEqual({ status: noOcr.status, stage: noOcr.failedStage, reason: noOcr.reasonCode }, {
    status: "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED",
    stage: "CAPTURING_COMMENTS",
    reason: "COMMENT_OCR_UNAVAILABLE"
  });
  assert.equal(noOcr.commentCount, 0);
  assert.deepEqual({ status: noSwipe.status, stage: noSwipe.failedStage, reason: noSwipe.reasonCode }, {
    status: "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED",
    stage: "SWIPING_COMMENTS",
    reason: "COMMENT_SWIPE_UNAVAILABLE"
  });
  assert.equal(noSwipe.commentCount, 1);
});
test("plain false and Task2 swipe failures normalize to COMMENT_SWIPE_FAILED", function () {
  [false, { success: false, reason: "DRIVER_REJECTED", message: "gesture denied" }].forEach(function (failure) {
    var run = runIsolated({
      readComments: function () { return { text: "首屏评论" }; },
      swipeComments: function () { return failure; }
    });
    assert.equal(run.result.reasonCode, "COMMENT_SWIPE_FAILED");
    assert.equal(run.result.failedStage, "SWIPING_COMMENTS");
    assert.equal(run.result.swipeCount, 0);
    assert.equal(run.result.commentCount, 1);
  });
});
test("Task2 success envelopes and callAction are unwrapped synchronously", function () {
  var reads = 0;
  var calls = [];
  var run = runIsolated({}, {
    callAction: function (name) {
      calls.push(name);
      if (name === "readComments") {
        reads += 1;
        return { success: true, value: { text: "统一结果" } };
      }
      return { success: true, value: true };
    }
  });
  assert.deepEqual([run.result.status, run.result.commentSwipeCount, run.result.commentSourceCount, reads],
    ["LIVE_COMMENT_ENTRY_ENTERED", 5, 6, 6]);
  assert.ok(calls.indexOf("waitRandom") >= 0);
});
test("platform verification stops at all OCR and swipe boundaries with partial comments", function () {
  [
    { stage: "CAPTURING_COMMENTS", phase: "before", reads: 0, swipes: 0, comments: 0 },
    { stage: "CAPTURING_COMMENTS", phase: "after", reads: 1, swipes: 0, comments: 1 },
    { stage: "SWIPING_COMMENTS", phase: "before", reads: 1, swipes: 0, comments: 1 },
    { stage: "SWIPING_COMMENTS", phase: "after", reads: 1, swipes: 1, comments: 1 }
  ].forEach(function (boundary) {
    var reads = 0;
    var swipes = 0;
    var run = runIsolated({
      readComments: function () { reads += 1; return { text: "甲：已抓取" }; },
      swipeComments: function () { swipes += 1; return true; }
    }, {
      detectPlatformVerification: function (stageName, control, details) {
        if (stageName === boundary.stage && details.phase === boundary.phase && details.pageIndex === 0) {
          return { detected: true, textSample: "请完成验证" };
        }
        return null;
      }
    });
    assert.deepEqual([run.result.status, run.result.cleanupRequired, run.result.platformVerification],
      ["LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION", true, true]);
    assert.deepEqual([run.result.commentCount, run.result.swipeCount, reads, swipes],
      [boundary.comments, boundary.swipes, boundary.reads, boundary.swipes]);
  });
});
test("Task2 verification failure envelope is recognized as platform verification", function () {
  var diagnostics = {
    risk: { signal: "slider" },
    pageStructure: { title: "安全验证" },
    actionTrace: ["enter-live", "capture"]
  };
  var run = runIsolated({
    readComments: function () { throw new Error("must not read"); },
    swipeComments: function () { return true; }
  }, {
    detectPlatformVerification: function () {
      return {
        success: false,
        reason: "PLATFORM_VERIFICATION",
        message: "verification required",
        details: copy({ textSample: "滑块验证" }, diagnostics)
      };
    }
  });
  assert.deepEqual([run.result.reasonCode, run.result.textSample, run.result.commentCount],
    ["PLATFORM_VERIFICATION", "滑块验证", 0]);
  assert.deepEqual(run.result.verificationDiagnostics, diagnostics);
});
test("custom platform verification failure receives partial-count details", function () {
  var received = null;
  var diagnostics = {
    risk: { signal: "captcha" },
    pageStructure: { title: "完成验证" },
    actionTrace: ["read-comments"]
  };
  var run = runIsolated({
    readComments: function () { return { text: "已抓取" }; },
    swipeComments: function () { return true; }
  }, {
    detectPlatformVerification: function (stageName, control, details) {
      return details.phase === "after" ? {
        success: false,
        reason: "PLATFORM_VERIFICATION",
        details: copy({ textSample: "请完成验证" }, diagnostics)
      } : null;
    },
    platformVerificationFailure: function (stageName, detection, details) {
      received = details;
      return { status: "CUSTOM_VERIFICATION", failedStage: stageName };
    }
  });
  assert.deepEqual([run.result.status, received.commentCount, received.capturePhase, received.phase],
    ["CUSTOM_VERIFICATION", 1, true, "after"]);
  assert.deepEqual([run.result.textSample, run.result.comments[0].commentText], ["请完成验证", "已抓取"]);
  assert.deepEqual(run.result.verificationDiagnostics, diagnostics);
});
test("verification check failure before OCR terminates without calling capture actions", function () {
  var reads = 0;
  var swipes = 0;
  var run = runIsolated({
    detectPlatformVerification: function () {
      return { success: false, reason: "VERIFICATION_CHECK_FAILED", message: "diagnostics failed" };
    },
    readComments: function () { reads += 1; return { text: "不应读取" }; },
    swipeComments: function () { swipes += 1; return true; }
  });
  assert.deepEqual([run.result.status, run.result.reasonCode, run.result.failedStage, run.result.commentCount],
    ["LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED", "VERIFICATION_CHECK_FAILED", "CAPTURING_COMMENTS", 0]);
  assert.deepEqual([reads, swipes], [0, 0]);
  assert.equal(run.events[run.events.length - 1].stage, "COMMENT_CAPTURE_FAILED");
});
test("verification check failure after OCR preserves partial and performs no later action", function () {
  var checks = 0;
  var reads = 0;
  var swipes = 0;
  var run = runIsolated({
    detectPlatformVerification: function () {
      checks += 1;
      return checks === 1
        ? { success: true, value: null }
        : { success: false, reason: "VERIFICATION_CHECK_FAILED", message: "after OCR failed" };
    },
    readComments: function () { reads += 1; return { text: "已读取" }; },
    swipeComments: function () { swipes += 1; return true; }
  });
  assert.deepEqual([run.result.reasonCode, run.result.commentCount, run.result.comments[0].commentText],
    ["VERIFICATION_CHECK_FAILED", 1, "已读取"]);
  assert.deepEqual([reads, swipes], [1, 0]);
  assert.equal(run.events[run.events.length - 1].stage, "COMMENT_CAPTURE_FAILED");
});
test("thrown verification checks fail closed at before and after OCR boundaries", function () {
  [
    { phase: "before", reads: 0, comments: 0 },
    { phase: "after", reads: 1, comments: 1 }
  ].forEach(function (boundary) {
    var checks = 0;
    var reads = 0;
    var swipes = 0;
    var run = runIsolated({
      detectPlatformVerification: function () {
        checks += 1;
        if (boundary.phase === "after" && checks === 1) return { success: true, value: null };
        throw new Error("detector crashed");
      },
      readComments: function () { reads += 1; return { text: "异常前已读取" }; },
      swipeComments: function () { swipes += 1; return true; }
    });
    assert.deepEqual([run.result.status, run.result.reasonCode, run.result.commentCount],
      ["LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED", "VERIFICATION_CHECK_FAILED", boundary.comments]);
    assert.match(run.result.message, /detector crashed/);
    assert.deepEqual([reads, swipes], [boundary.reads, 0]);
    assert.equal(run.events[run.events.length - 1].stage, "COMMENT_CAPTURE_FAILED");
  });
});
test("reportStage comments are deeply isolated from a successful result", function () {
  var completedEvent = null;
  var runner = runnerModule.createCommentCaptureRunner({
    runtime: {
      readComments: function () { return { text: "原始评论" }; },
      swipeComments: function () { return true; },
      waitRandom: function () {}
    },
    reportStage: function (event) {
      if (event.stage !== "COMMENTS_CAPTURED") return;
      completedEvent = event;
      event.comments[0].commentText = "事件修改";
      event.comments[0].sources[0].commentText = "事件来源修改";
    }
  });
  var result = runner.capture(SCOPE);
  assert.deepEqual([result.comments[0].commentText, result.comments[0].sources[0].commentText],
    ["原始评论", "原始评论"]);
  result.comments[0].commentText = "结果修改";
  result.comments[0].sources[0].commentText = "结果来源修改";
  assert.deepEqual([completedEvent.comments[0].commentText, completedEvent.comments[0].sources[0].commentText],
    ["事件修改", "事件来源修改"]);
});
test("stage alias comments are deeply isolated from a failure partial result", function () {
  var reads = 0;
  var failedEvent = null;
  var runner = runnerModule.createCommentCaptureRunner({
    runtime: {
      readComments: function () {
        reads += 1;
        return reads === 1
          ? { text: "原始部分评论" }
          : { success: false, reason: "OCR_FAILED", message: "OCR failed" };
      },
      swipeComments: function () { return true; },
      waitRandom: function () {}
    },
    stage: function (name, event) {
      if (name !== "COMMENT_CAPTURE_FAILED") return;
      failedEvent = event;
      event.comments[0].commentText = "失败事件修改";
      event.comments[0].sources[0].commentText = "失败来源修改";
    }
  });
  var result = runner.capture(SCOPE);
  assert.deepEqual([result.comments[0].commentText, result.comments[0].sources[0].commentText],
    ["原始部分评论", "原始部分评论"]);
  result.comments[0].commentText = "失败结果修改";
  result.comments[0].sources[0].commentText = "失败结果来源修改";
  assert.deepEqual([failedEvent.comments[0].commentText, failedEvent.comments[0].sources[0].commentText],
    ["失败事件修改", "失败来源修改"]);
});
test("stop checks preserve completed OCR or swipe work and bound later actions", function () {
  var stoppedAfterRead = false;
  var readStop = runIsolated({
    readComments: function () { stoppedAfterRead = true; return { text: "停止前抓取" }; },
    swipeComments: function () { throw new Error("must not swipe"); }
  }, null, { shouldStop: function () { return stoppedAfterRead; } }).result;
  assert.deepEqual([readStop.status, readStop.commentPageCount, readStop.commentCount], ["STOPPED", 1, 1]);
  var stoppedAfterSwipe = false;
  var swipeStop = runIsolated({
    readComments: function () { return { text: "停止前抓取" }; },
    swipeComments: function () { stoppedAfterSwipe = true; return true; }
  }, null, { shouldStop: function () { return stoppedAfterSwipe; } }).result;
  assert.deepEqual([swipeStop.status, swipeStop.commentSwipeCount, swipeStop.commentCount], ["STOPPED", 1, 1]);
  var retryReads = 0;
  var stoppedInRetryWait = false;
  var retryWaitStop = runIsolated({
    readComments: function () { retryReads += 1; return { text: "" }; },
    swipeComments: function () { return true; },
    waitRandom: function () { stoppedInRetryWait = true; }
  }, null, { shouldStop: function () { return stoppedInRetryWait; } }).result;
  assert.equal(retryWaitStop.status, "STOPPED");
  assert.equal(retryReads, 1);
  var swipeWaitReads = 0;
  var stoppedInSwipeWait = false;
  var swipeWaitStop = runIsolated({
    readComments: function () { swipeWaitReads += 1; return { text: "甲：已抓取" }; },
    swipeComments: function () { return true; },
    waitRandom: function () { stoppedInSwipeWait = true; }
  }, null, { shouldStop: function () { return stoppedInSwipeWait; } }).result;
  assert.deepEqual([swipeWaitStop.status, swipeWaitStop.commentSwipeCount, swipeWaitReads], ["STOPPED", 1, 1]);
});
function timedRunner(profile, hooks) {
  hooks = hooks || {};
  var clock = 0, reads = 0, swipes = 0, waits = [];
  var stopped = false;
  var timing = createTiming({ profile: profile, random: function (min) { return min; },
    sleep: function (milliseconds) {
      waits.push(milliseconds); clock += milliseconds;
      if (hooks.stopDuringWait) stopped = true;
    } });
  var runtime = createTimedRuntime({ actionTiming: timing, control: { shouldStop: function () { return stopped; } },
    actions: {
      readComments: function () { reads += 1; return { success: true, value: { text: "captured" } }; },
      swipeComments: function () { swipes += 1; return { success: true, value: { endDetected: !!hooks.endDetected } }; }
    } });
  var runnerOptions = { runtime: runtime, maxSwipeCount: 1,
    now: function () { return clock; }, shouldStop: function () { return stopped; },
    detectPlatformVerification: function () { return null; } };
  if (hooks.deadline) runnerOptions.captureDurationMinutes = 1;
  var result = runnerModule.createCommentCaptureRunner(runnerOptions).capture(SCOPE);
  return { result: result, reads: reads, swipes: swipes, waits: waits, clock: clock };
}
test("timed runtime and runner apply swipe after timing exactly once", function () {
  var run = timedRunner({ schemaVersion: 1, actions: {
    swipeComments: { beforeMs: [0, 0], afterMs: [10, 10] }
  } });
  assert.deepEqual([run.result.captureStopReason, run.swipes, run.clock], ["SWIPE_LIMIT_REACHED", 1, 10]);
  assert.deepEqual(run.waits, [10]);
});
test("timing deadline prevents a new action without reporting capture failure", function () {
  var run = timedRunner({ schemaVersion: 1, actions: {
    readComments: { beforeMs: [60000, 60000], afterMs: [0, 0] }
  } }, { deadline: true });
  assert.deepEqual([run.result.captureStopReason, run.result.commentCount, run.reads, run.swipes],
    ["DURATION_REACHED", 0, 0, 0]);
});
test("completed OCR survives an after wait that reaches the deadline", function () {
  var run = timedRunner({ schemaVersion: 1, actions: {
    readComments: { beforeMs: [0, 0], afterMs: [60000, 60000] }
  } }, { deadline: true });
  assert.deepEqual([run.result.captureStopReason, run.result.commentCount, run.reads, run.swipes],
    ["DURATION_REACHED", 1, 1, 0]);
});
test("completed OCR and swipe survive stop during their after timing", function () {
  var read = timedRunner({ schemaVersion: 1, actions: {
    readComments: { beforeMs: [0, 0], afterMs: [100, 100] }
  } }, { stopDuringWait: true });
  assert.deepEqual([read.result.status, read.result.commentCount, read.reads], ["STOPPED", 1, 1]);
  var swipe = timedRunner({ schemaVersion: 1, actions: {
    readComments: { beforeMs: [0, 0], afterMs: [0, 0] },
    swipeComments: { beforeMs: [0, 0], afterMs: [100, 100] }
  } }, { stopDuringWait: true });
  assert.deepEqual([swipe.result.status, swipe.result.commentCount, swipe.result.commentSwipeCount], ["STOPPED", 1, 1]);
});
test("shouldStop, stopped and control aliases stop before any runtime action", function () {
  var actions = 0;
  var runtime = { readComments: function () { actions += 1; } };
  var results = [
    runIsolated(runtime, { shouldStop: function () { return true; } }).result,
    runIsolated(runtime, { stopped: function () { return true; } }).result,
    runIsolated(runtime, { control: { shouldStop: function () { return true; } } }).result
  ];
  assert.deepEqual(results.map(function (result) { return result.status; }), ["STOPPED", "STOPPED", "STOPPED"]);
  assert.equal(actions, 0);
});
test("isolated runner source never requires legacy business modules", function () {
  var source = fs.readFileSync(path.join(__dirname, "../features/new-comment/comment-runner.js"), "utf8");
  assert.doesNotMatch(source, /account-warmup|domain[\\/]live-comment-capture/);
  assert.doesNotMatch(source, /\basync\b|\bPromise\b/);
});
