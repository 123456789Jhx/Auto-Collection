"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var capture = require("../features/new-comment/comment-capture.js");
var runnerModule = require("../features/new-comment/comment-runner.js");
var legacyCapture = require("../domain/live-comment-capture.js");
var legacyRunnerModule = require("../features/account-warmup/live-comment-entry-comment-runner.js");

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

function legacyCall(runtime, control, name, failedStage, args) {
  if (control && control.shouldStop && control.shouldStop()) return { stopped: true };
  try {
    var value = runtime[name].apply(runtime, args || []);
    if (value === false || value && value.success === false) {
      return { failed: true, value: value, message: String(value && (value.message || value.reason) || failedStage) };
    }
    return { value: value };
  } catch (error) {
    return { failed: true, message: String(error.message || error) };
  }
}

function runLegacy(runtime, control) {
  var events = [];
  var runner = legacyRunnerModule.createCommentCaptureRunner({
    runtime: runtime,
    commentCapture: legacyCapture,
    stage: function (name, payload) { events.push(copy({ stage: name }, payload)); },
    stopped: function (activeControl) {
      return !!(activeControl && activeControl.shouldStop && activeControl.shouldStop());
    },
    call: function (name, failedStage, args, activeControl) {
      return legacyCall(runtime, activeControl, name, failedStage, args);
    }
  });
  return { result: runner.capture(SCOPE, control), events: events };
}

test("runner exports bounded loop constants", function () {
  assert.equal(runnerModule.COMMENT_OCR_ATTEMPTS, 3);
  assert.equal(runnerModule.MAX_CONSECUTIVE_NO_NEW_PAGES, 2);
});

test("six-page success result and stage payloads stay equivalent to the legacy runner", function () {
  function runtime() {
    var reads = 0;
    return {
      readComments: function () { reads += 1; return { text: "用户" + reads + "：评论" + reads }; },
      swipeComments: function () { return true; },
      waitRandom: function () {}
    };
  }
  var legacyRun = runLegacy(runtime());
  var isolatedRun = runIsolated(runtime());

  assert.deepEqual(isolatedRun.result, legacyRun.result);
  assert.deepEqual(isolatedRun.events, legacyRun.events);
  assert.equal(isolatedRun.result.commentSwipeCount, 5);
  assert.equal(isolatedRun.result.commentPageCount, 6);
});

test("empty OCR retries up to the third attempt before continuing through five swipes", function () {
  var reads = 0;
  var swipes = 0;
  var run = runIsolated({
    readComments: function () {
      reads += 1;
      return { text: reads < 3 ? "" : "用户：第" + reads + "次读取" };
    },
    swipeComments: function () { swipes += 1; return true; },
    waitRandom: function () {}
  });

  assert.equal(run.result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.equal(reads, 8);
  assert.equal(swipes, 5);
  assert.deepEqual(run.events.filter(function (event) {
    return event.stage === "CAPTURING_COMMENTS" && event.pageIndex === 0;
  }).map(function (event) { return event.ocrAttempt; }), [1, 2, 3]);
  assert.equal(run.events.filter(function (event) {
    return event.stage === "RETRYING_COMMENT_OCR";
  }).length, 2);
});

test("two already-swiped no-new pages stop early while duplicate sources remain", function () {
  var page = 0;
  var run = runIsolated({
    readComments: function () {
      page += 1;
      return { text: "用户" + page + "：相 同 评论" };
    },
    swipeComments: function () { return true; },
    waitRandom: function () {}
  });

  assert.equal(run.result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.equal(run.result.captureStopReason, "NO_NEW_COMMENTS");
  assert.equal(run.result.commentSwipeCount, 2);
  assert.equal(run.result.commentPageCount, 3);
  assert.equal(run.result.commentCount, 1);
  assert.equal(run.result.commentSourceCount, 3);
  assert.equal(run.result.comments[0].sources.length, 3);
});

test("OCR exceptions exhaust three attempts and preserve prior-page candidates", function () {
  var reads = 0;
  var run = runIsolated({
    readComments: function () {
      reads += 1;
      if (reads === 1) return { text: "甲：已抓到的评论" };
      throw new Error("OCR_ENGINE_FAILED");
    },
    swipeComments: function () { return true; },
    waitRandom: function () {}
  });

  assert.equal(reads, 4);
  assert.equal(run.result.status, "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED");
  assert.equal(run.result.failedStage, "CAPTURING_COMMENTS");
  assert.equal(run.result.reasonCode, "COMMENT_OCR_FAILED");
  assert.equal(run.result.commentCount, 1);
  assert.equal(run.result.comments[0].commentText, "已抓到的评论");
});

test("missing OCR and swipe capabilities return legacy failure payloads with partial data", function () {
  var noOcr = runIsolated({ swipeComments: function () { return true; } }).result;
  var noSwipe = runIsolated({ readComments: function () { return { text: "甲：首屏评论" }; } }).result;

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
      readComments: function () { return { text: "甲：首屏评论" }; },
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
        return { success: true, value: { text: "甲：统一结果" } };
      }
      return { success: true, value: true };
    }
  });

  assert.equal(run.result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.equal(run.result.commentSwipeCount, 2);
  assert.equal(run.result.commentSourceCount, 3);
  assert.equal(reads, 3);
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

    assert.equal(run.result.status, "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION");
    assert.equal(run.result.cleanupRequired, true);
    assert.equal(run.result.platformVerification, true);
    assert.equal(run.result.commentCount, boundary.comments);
    assert.equal(run.result.swipeCount, boundary.swipes);
    assert.equal(reads, boundary.reads);
    assert.equal(swipes, boundary.swipes);
  });
});

test("Task2 verification failure envelope is recognized as platform verification", function () {
  var run = runIsolated({
    readComments: function () { throw new Error("must not read"); },
    swipeComments: function () { return true; }
  }, {
    detectPlatformVerification: function () {
      return {
        success: false,
        reason: "PLATFORM_VERIFICATION",
        message: "verification required",
        details: { textSample: "滑块验证" }
      };
    }
  });

  assert.equal(run.result.reasonCode, "PLATFORM_VERIFICATION");
  assert.equal(run.result.textSample, "滑块验证");
  assert.equal(run.result.commentCount, 0);
});

test("custom platform verification failure receives the legacy partial-count details", function () {
  var received = null;
  var run = runIsolated({
    readComments: function () { return { text: "甲：已抓取" }; },
    swipeComments: function () { return true; }
  }, {
    detectPlatformVerification: function (stageName, control, details) {
      return details.phase === "after" ? { detected: true } : null;
    },
    platformVerificationFailure: function (stageName, detection, details) {
      received = details;
      return { status: "CUSTOM_VERIFICATION", failedStage: stageName };
    }
  });

  assert.equal(run.result.status, "CUSTOM_VERIFICATION");
  assert.equal(received.commentCount, 1);
  assert.equal(received.capturePhase, true);
  assert.equal(received.phase, "after");
});

test("stop checks preserve completed OCR or swipe work and bound later actions", function () {
  var stoppedAfterRead = false;
  var readStop = runIsolated({
    readComments: function () { stoppedAfterRead = true; return { text: "甲：停止前抓取" }; },
    swipeComments: function () { throw new Error("must not swipe"); }
  }, null, { shouldStop: function () { return stoppedAfterRead; } }).result;
  assert.deepEqual([readStop.status, readStop.commentPageCount, readStop.commentCount], ["STOPPED", 1, 1]);

  var stoppedAfterSwipe = false;
  var swipeStop = runIsolated({
    readComments: function () { return { text: "甲：停止前抓取" }; },
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
