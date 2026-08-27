"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var legacyFactory = require("../features/account-warmup/live-comment-entry.js").createLiveCommentEntryTask;
var commentCapture = require("../features/new-comment/comment-capture.js");
var layout = require("../features/new-comment/douyin-layout.js");

function feature(name) {
  return require("../features/new-comment/" + name + ".js");
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function runtimeFixture(overrides) {
  var actions = [];
  var runtime = {
    openDouyin: function () { actions.push("openDouyin"); return true; },
    openSearch: function (keyword) { actions.push("openSearch:" + keyword); return true; },
    restartSearch: function (keyword) { actions.push("restartSearch:" + keyword); return true; },
    openLiveTab: function () { actions.push("openLiveTab"); return true; },
    openFirstLive: function () { actions.push("openFirstLive"); return true; },
    isLiveRoom: function () { actions.push("isLiveRoom"); return true; },
    readViewerCount: function () { actions.push("readViewerCount"); return { count: 25, source: "ocr" }; },
    nextLive: function () { actions.push("nextLive"); return true; },
    waitRandom: function () { actions.push("waitRandom"); return true; }
  };
  Object.keys(overrides || {}).forEach(function (key) { runtime[key] = overrides[key]; });
  runtime.actions = actions;
  return runtime;
}

function captureFixture(received, result) {
  return {
    capture: function (scope) {
      received.push(copy(scope));
      return copy(result || {
        status: "LIVE_COMMENT_ENTRY_ENTERED",
        captureStatus: "LIVE_COMMENT_ENTRY_CAPTURED",
        commentCount: 2
      });
    }
  };
}

function runLegacy(runtime, payload, received) {
  var stages = [];
  var capture = captureFixture(received);
  var task = legacyFactory({
    runtime: runtime,
    deviceId: "device-1",
    reportStage: function (event) { stages.push(copy(event)); },
    captureRunnerModule: { createCommentCaptureRunner: function () { return capture; } }
  });
  return { result: task.run(payload, { shouldStop: function () { return false; } }), stages: stages };
}

function runIsolated(runtime, payload, received, overrides) {
  var stages = [];
  var options = {
    runtime: runtime,
    deviceId: "device-1",
    reportStage: function (event) { stages.push(copy(event)); },
    commentRunner: captureFixture(received)
  };
  Object.keys(overrides || {}).forEach(function (key) { options[key] = overrides[key]; });
  var workflow = feature("workflow").createIsolatedLiveCommentWorkflow(options);
  return { result: workflow.run(payload, { shouldStop: function () { return false; } }), stages: stages };
}

test("workflow keeps legacy success actions, stages, result fields and capture scope", function () {
  var payload = { targetKeyword: "药材种植", minViewerCount: 10, batchId: "batch-1" };
  var legacyScope = [];
  var isolatedScope = [];
  var legacyRuntime = runtimeFixture();
  var isolatedRuntime = runtimeFixture();
  var legacy = runLegacy(legacyRuntime, payload, legacyScope);
  var isolated = runIsolated(isolatedRuntime, payload, isolatedScope);
  var withoutWait = function (item) { return item !== "waitRandom"; };

  assert.deepEqual(isolatedRuntime.actions.filter(withoutWait), legacyRuntime.actions.filter(withoutWait));
  assert.deepEqual(isolated.stages.map(function (event) { return event.stage; }),
    legacy.stages.map(function (event) { return event.stage; }));
  assert.deepEqual(isolated.result, legacy.result);
  assert.deepEqual(isolatedScope, legacyScope);
  assert.deepEqual(isolatedScope[0], {
    batchId: "batch-1",
    deviceId: "device-1",
    roomKey: "live-comment:药材种植:candidate:1"
  });
});

test("workflow retries one missing first result and confirms a room at most three times", function () {
  var opens = 0;
  var confirmations = 0;
  var runtime = runtimeFixture({
    openFirstLive: function () {
      opens += 1;
      return opens === 1 ? { success: false, reason: "NO_RESULT" } : true;
    },
    isLiveRoom: function () { confirmations += 1; return confirmations === 3; }
  });
  var run = runIsolated(runtime, { targetKeyword: "关键词" }, []);

  assert.equal(run.result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.deepEqual([opens, confirmations], [2, 3]);
  assert.equal(runtime.actions.filter(function (action) {
    return action === "restartSearch:关键词";
  }).length, 1);
  assert.equal(run.stages.filter(function (event) { return event.stage === "RETRYING_SEARCH"; }).length, 1);
});

test("workflow skips ended rooms and exhausts bounded low-viewer candidates", function () {
  var endedReads = 0;
  var endedRuntime = runtimeFixture({
    readViewerCount: function () {
      endedReads += 1;
      return endedReads === 1
        ? { count: null, ended: true, source: "ocr", endedTextSample: "直播已结束" }
        : { count: 21, ended: false, source: "ocr" };
    }
  });
  var ended = runIsolated(endedRuntime, {
    targetKeyword: "关键词", minViewerCount: 10, maxCandidateRooms: 2
  }, []);
  assert.equal(ended.result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.equal(ended.result.viewerCount, 21);
  assert.ok(ended.stages.some(function (event) { return event.stage === "SKIPPING_ENDED_LIVE_ROOM"; }));

  var lowReads = [2, 3];
  var lowRuntime = runtimeFixture({
    readViewerCount: function () { return { count: lowReads.shift(), source: "ocr" }; }
  });
  var low = runIsolated(lowRuntime, {
    targetKeyword: "关键词", minViewerCount: 10, maxCandidateRooms: 2
  }, []);
  assert.deepEqual({ status: low.result.status, reason: low.result.reasonCode, count: low.result.viewerCount }, {
    status: "LIVE_COMMENT_ENTRY_VIEWER_THRESHOLD_EXHAUSTED",
    reason: "VIEWER_THRESHOLD_NOT_MET",
    count: 3
  });
  assert.equal(lowRuntime.actions.filter(function (action) { return action === "nextLive"; }).length, 1);
});

test("workflow stops around actions and fails closed on verification detection errors", function () {
  var calls = 0;
  var stopped = feature("workflow").createIsolatedLiveCommentWorkflow({
    runtime: { openDouyin: function () { calls += 1; } },
    commentRunner: captureFixture([])
  }).run({}, { shouldStop: function () { return true; } });
  assert.deepEqual(stopped, { status: "STOPPED" });
  assert.equal(calls, 0);

  var diagnostics = {
    risk: { detected: true },
    pageStructure: { title: "安全验证" },
    actionTrace: ["openDouyin"]
  };
  var detected = runIsolated(runtimeFixture({
    detectPlatformVerification: function () {
      return { success: false, reason: "PLATFORM_VERIFICATION", details: diagnostics };
    }
  }), { targetKeyword: "关键词" }, []).result;
  assert.equal(detected.status, "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION");
  assert.equal(detected.cleanupRequired, true);
  assert.deepEqual(detected.verificationDiagnostics, diagnostics);

  var failedOpenVerification = runIsolated(runtimeFixture({
    openDouyin: function () { return false; },
    detectPlatformVerification: function () {
      return { success: false, reason: "PLATFORM_VERIFICATION", details: diagnostics };
    }
  }), { targetKeyword: "关键词" }, []).result;
  assert.equal(failedOpenVerification.status, "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION");

  var laterActions = 0;
  var checkFailed = runIsolated(runtimeFixture({
    detectPlatformVerification: function () {
      return { success: false, reason: "VERIFICATION_CHECK_FAILED", message: "detector crashed",
        details: { actionTrace: ["openDouyin"] } };
    },
    openSearch: function () { laterActions += 1; return true; }
  }), { targetKeyword: "关键词" }, []).result;
  assert.equal(checkFailed.status, "LIVE_COMMENT_ENTRY_FAILED");
  assert.equal(checkFailed.reasonCode, "VERIFICATION_CHECK_FAILED");
  assert.equal(laterActions, 0);
});

test("workflow always cleans capture results and preserves legacy cleanup conversions", function () {
  function captureResult(value) { return { capture: function () { return copy(value); } }; }
  var cleanupCalls = 0;
  var cleanup = { run: function (payload, lifecycle) {
    cleanupCalls += 1;
    lifecycle.beforeReturnToAgent();
    return { completed: true };
  } };
  var success = runIsolated(runtimeFixture(), { targetKeyword: "关键词" }, [], {
    commentRunner: captureResult({ status: "LIVE_COMMENT_ENTRY_ENTERED", captureStatus: "LIVE_COMMENT_ENTRY_CAPTURED" }),
    finalCleanup: cleanup
  });
  assert.deepEqual([success.result.status, success.result.captureStatus, cleanupCalls],
    ["LIVE_COMMENT_ENTRY_ENTERED", "LIVE_COMMENT_ENTRY_CAPTURED", 1]);
  assert.ok(success.stages.some(function (event) { return event.stage === "RETURNING_TO_AGENT"; }));

  var failed = runIsolated(runtimeFixture(), { targetKeyword: "关键词" }, [], {
    commentRunner: captureResult({ status: "LIVE_COMMENT_ENTRY_ENTERED" }),
    finalCleanup: { run: function () { return { completed: false, reason: "DISMISS_FAILED" }; } }
  }).result;
  assert.equal(failed.status, "LIVE_COMMENT_ENTRY_CLEANUP_FAILED");

  var verification = runIsolated(runtimeFixture(), { targetKeyword: "关键词" }, [], {
    commentRunner: captureResult({
      status: "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION",
      capturePlatformVerification: true,
      cleanupRequired: true
    }),
    finalCleanup: cleanup
  }).result;
  assert.equal(verification.status, "LIVE_COMMENT_ENTRY_CAPTURE_PLATFORM_VERIFICATION");
  assert.equal(verification.cleanupRequired, false);

  var stopCleanupCalls = 0;
  var partialStop = runIsolated(runtimeFixture(), { targetKeyword: "关键词" }, [], {
    commentRunner: captureResult({ status: "STOPPED", commentCount: 1, comments: [{ commentText: "部分" }] }),
    finalCleanup: { run: function () { stopCleanupCalls += 1; } }
  }).result;
  assert.equal(partialStop.commentCount, 1);
  assert.equal(stopCleanupCalls, 0);
});

test("runtime wires atoms, OCR regions, recycling and bounded read-only diagnostics", function () {
  var events = [];
  var requestedRegions = [];
  var screenRecycled = 0;
  var clipRecycled = 0;
  var diagnosticRecycled = 0;
  var ocrText = ["甲：评论", "在线 88 人", ""];
  var size = { width: 100, height: 200 };
  var recognizer = {
    extractScreen: function () { throw new Error("legacy extractScreen must not run"); },
    extractFastText: function () {
      return { image: { recycle: function () { diagnosticRecycled += 1; } }, combinedText: "请完成安全验证",
        visibleStructure: { title: "安全验证" } };
    }
  };
  var runtime = feature("runtime").createIsolatedRuntime({
    douyin: {
      openApp: function () { events.push("openApp"); return true; },
      openLiveRoomFromCurrentScreen: function () { events.push("openLiveRoomFromCurrentScreen"); return true; }
    },
    screenRecognizer: recognizer,
    ocrEngine: { recognize: function (clip) { return clip.text; } },
    riskDetector: { detectRisk: function () { return { detected: true, reasonCode: "PLATFORM_VERIFICATION" }; } },
    viewerCountParser: { parseViewerBadgeCount: function () { return 88; } }
  }, {
    control: { shouldStop: function () { return false; } },
    screenSize: function () { return size; },
    captureScreen: function () { return { image: {
      recycle: function () { screenRecycled += 1; }
    }, width: size.width, height: size.height }; },
    images: { clip: function (image, x, y, w, h) {
      requestedRegions.push({ x: x, y: y, w: w, h: h });
      return { text: ocrText.shift(), recycle: function () { clipRecycled += 1; } };
    } },
    sleep: function () {},
    random: function (min) { return min; },
    findNode: function () { return { x: 10, y: 12 }; },
    accessibility: { createGestureDriver: function () {
      return {
        tap: function () { events.push("tap"); return { success: true }; },
        swipe: function () { events.push("swipe"); return { success: true }; }
      };
    } },
    actionTraceLimit: 4
  });

  assert.equal(runtime.openDouyin().success, true);
  assert.equal(runtime.openLiveTab().success, true);
  assert.equal(runtime.openFirstLive().success, true);
  assert.equal(runtime.swipeComments().success, true);
  assert.equal(runtime.nextLive().success, true);
  var comments = runtime.readComments();
  assert.equal(comments.success, true);
  assert.deepEqual(comments.value, { text: "甲：评论", source: "commentArea" });
  assert.equal(runtime.readViewerCount().value.count, 88);
  var verification = runtime.detectPlatformVerification();
  assert.equal(verification.reason, "PLATFORM_VERIFICATION");
  assert.deepEqual(verification.details.pageStructure, { title: "安全验证" });
  assert.ok(verification.details.actionTrace.length <= 4);
  assert.deepEqual(requestedRegions[0], commentCapture.commentOcrRegion(size));
  var viewer = layout.getRegion("viewerCount", size);
  assert.deepEqual(requestedRegions[1],
    { x: viewer.left, y: viewer.top, w: viewer.width, h: viewer.height });
  assert.equal(screenRecycled, 2);
  assert.equal(clipRecycled, 3);
  assert.equal(diagnosticRecycled, 1);
  assert.equal(events.indexOf("openLiveRoomFromCurrentScreen") >= 0, true);
  assert.deepEqual(events.slice(-2), ["swipe", "swipe"]);

  var failureRecycles = 0;
  var failureClips = 0;
  var parserFailureRuntime = feature("runtime").createIsolatedRuntime({
    ocrEngine: { recognize: function () { return "bad"; } },
    viewerCountParser: { parseViewerBadgeCount: function () { throw new Error("parser crashed"); } }
  }, { screenSize: function () { return size; },
    captureScreen: function () { return { image: { recycle: function () { failureRecycles += 1; } },
      width: size.width, height: size.height }; },
    images: { clip: function () { return { recycle: function () { failureClips += 1; } }; } } });
  var parserFailure;
  assert.doesNotThrow(function () { parserFailure = parserFailureRuntime.readViewerCount(); });
  assert.equal(parserFailure.success, false);
  assert.equal(failureRecycles, 1);
  assert.equal(failureClips, 2);
});

test("cleanup performs exact recents order, falls back safely and is idempotent", function () {
  var events = [];
  var lifecycleCalls = 0;
  var cleanup = feature("cleanup").createIsolatedCleanup({}, {
    openRecents: function () { events.push("recents"); return true; },
    isDouyinForeground: function () { return false; },
    isRecentsPackage: function () { return true; },
    findDouyinCard: function () { events.push("find:douyin"); return {}; },
    dismissCard: function () { events.push("left-dismiss"); return true; },
    findAgentCard: function () { events.push("find:agent"); return {}; },
    openAgentCard: function () { events.push("open:agent"); return true; },
    wait: function () {}
  });
  var lifecycle = { beforeReturnToAgent: function () { lifecycleCalls += 1; events.push("lifecycle"); } };
  var first = cleanup.run({ taskId: "task-1" }, lifecycle);
  var second = cleanup.run({ taskId: "task-1" }, lifecycle);
  assert.deepEqual(events, ["recents", "find:douyin", "left-dismiss", "lifecycle", "find:agent", "open:agent"]);
  assert.equal(first.completed, true);
  assert.equal(second.cached, true);
  assert.equal(lifecycleCalls, 1);

  var fallbackEvents = [];
  var fallback = feature("cleanup").createIsolatedCleanup({}, {
    openRecents: function () { return false; },
    goHome: function () { fallbackEvents.push("home"); return true; },
    findAgentHomeIcon: function () { return null; },
    openAgentByPackage: function () { fallbackEvents.push("package"); return true; },
    wait: function () {}
  }).run({}, { beforeReturnToAgent: function () { fallbackEvents.push("lifecycle"); } });
  assert.equal(fallback.completed, true);
  assert.equal(fallback.fallback, "PACKAGE");
  assert.deepEqual(fallbackEvents, ["lifecycle", "home", "package"]);

  var stable = feature("cleanup").createIsolatedCleanup({}, {
    openRecents: function () { throw new Error("recents crashed"); },
    goHome: function () { throw new Error("home crashed"); },
    openAgentByPackage: function () { return false; }
  }).run({});
  assert.equal(stable.completed, false);
  assert.equal(typeof stable.reason, "string");

  var centeredDismisses = 0;
  var centeredForeground = [true, false];
  var centered = feature("cleanup").createIsolatedCleanup({}, {
    openRecents: function () { return true; },
    findDouyinCard: function () { return null; },
    isDouyinForeground: function () { return centeredForeground.shift(); },
    findCenteredTaskCard: function () { return { id: "centered" }; },
    dismissCard: function (card) { centeredDismisses += card.id === "centered" ? 1 : 0; return true; },
    findAgentCard: function () { return {}; },
    openAgentCard: function () { return true; },
    wait: function () {}
  }).run({});
  assert.equal(centered.completed, true);
  assert.equal(centeredDismisses, 1);
});

test("entry task creates a runtime per run and exposes the same idempotent cleanup", function () {
  var controls = [];
  var cleanup = { run: function () { return { completed: true }; } };
  var task = feature("index").createIsolatedLiveCommentEntryTask({}, {
    finalCleanup: cleanup,
    runtime: { control: { name: "shared" } },
    createRuntime: function (context, options) { controls.push(options.control); return { control: options.control }; },
    createWorkflow: function (options) {
      return { run: function () { return { status: options.runtime.control.name }; } };
    }
  });
  var first = { name: "first" };
  var second = { name: "second" };
  assert.equal(task.run({}, first).status, "first");
  assert.equal(task.run({}, second).status, "second");
  assert.deepEqual(controls, [first, second]);
  assert.equal(task.cleanup, cleanup);
});
