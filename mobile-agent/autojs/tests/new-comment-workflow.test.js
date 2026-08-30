"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
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

test("workflow waits for stop after entering without post-entry business actions", function () {
  var entered = false;
  var stopRequested = false;
  var waitCount = 0;
  var captureCalls = 0;
  var cleanupCalls = 0;
  var runtime = runtimeFixture({
    detectPlatformVerification: function () { throw new Error("verification must not run"); },
    isLiveRoom: function () {
      entered = true;
      return true;
    },
    waitRandom: function () {
      waitCount += 1;
      if (waitCount >= 5) {
        entered = true;
        stopRequested = true;
      }
      runtime.actions.push("waitRandom");
      return true;
    }
  });
  var stages = [];
  var workflow = feature("workflow").createIsolatedLiveCommentWorkflow({
    runtime: runtime,
    reportStage: function (event) { stages.push(copy(event)); },
    commentRunner: {
      capture: function () {
        captureCalls += 1;
        return { status: "LIVE_COMMENT_ENTRY_CAPTURED" };
      }
    },
    finalCleanup: {
      run: function () {
        cleanupCalls += 1;
        return { completed: true };
      }
    }
  });

  var result = workflow.run({ targetKeyword: "关键词", minViewerCount: 300 }, {
    shouldStop: function () { return stopRequested; }
  });

  assert.deepEqual(result, { status: "STOPPED" });
  assert.equal(runtime.actions.includes("readViewerCount"), false);
  assert.equal(runtime.actions.includes("nextLive"), false);
  assert.equal(captureCalls, 0);
  assert.equal(cleanupCalls, 0);
  assert.equal(stages.filter(function (event) { return event.stage === "ENTERED"; }).length, 1);
});

test("workflow does not fail the task when the live-room click reports failure", function () {
  var opens = 0;
  var stopRequested = false;
  var waitCount = 0;
  var runtime = runtimeFixture({
    openFirstLive: function () {
      opens += 1;
      return { success: false, reason: "NO_RESULT" };
    },
    waitRandom: function () {
      waitCount += 1;
      if (waitCount >= 4) stopRequested = true;
      runtime.actions.push("waitRandom");
      return true;
    },
    detectPlatformVerification: function () { throw new Error("verification must not run"); }
  });
  var workflow = feature("workflow").createIsolatedLiveCommentWorkflow({
    runtime: runtime,
    commentRunner: captureFixture([])
  });
  var result = workflow.run({ targetKeyword: "关键词" }, { shouldStop: function () { return stopRequested; } });

  assert.equal(result.status, "STOPPED");
  assert.equal(opens, 1);
  assert.equal(runtime.actions.includes("restartSearch:关键词"), false);
  assert.equal(runtime.actions.includes("isLiveRoom"), false);
});

test("workflow stops around actions without platform verification scans", function () {
  var calls = 0;
  var stopped = feature("workflow").createIsolatedLiveCommentWorkflow({
    runtime: { openDouyin: function () { calls += 1; } },
    commentRunner: captureFixture([])
  }).run({}, { shouldStop: function () { return true; } });
  assert.deepEqual(stopped, { status: "STOPPED" });
  assert.equal(calls, 0);

  var stopRequested = false;
  var detectorCalls = 0;
  var runtime = runtimeFixture({
    detectPlatformVerification: function () {
      detectorCalls += 1;
      return { success: false, reason: "PLATFORM_VERIFICATION" };
    },
    waitRandom: function () {
      stopRequested = true;
      return true;
    }
  });
  var result = feature("workflow").createIsolatedLiveCommentWorkflow({ runtime: runtime }).run(
    { targetKeyword: "关键词" }, { shouldStop: function () { return stopRequested; } });
  assert.equal(result.status, "STOPPED");
  assert.equal(detectorCalls, 0);
});

test("runtime wires atoms, OCR regions, recycling and bounded read-only diagnostics", function () {
  var events = [];
  var liveEntryOptions = null;
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
      openLiveRoomFromCurrentScreen: function (visibleTextHint, options) {
        events.push("openLiveRoomFromCurrentScreen");
        liveEntryOptions = options;
        return true;
      }
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
  assert.deepEqual(liveEntryOptions, { skipLiveRoomVerification: true });
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
