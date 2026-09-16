"use strict";
var assert = require("node:assert/strict");
var test = require("node:test");
var commentCapture = require("../features/new-comment/comment-capture.js");
var layout = require("../features/new-comment/douyin-layout.js");
var cleanupModule = require("../features/publish-video/douyin-post-publish-cleanup.js");
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
    openAnchorSummary: function () { actions.push("openAnchorSummary"); return true; },
    openAnchorProfile: function () { actions.push("openAnchorProfile"); return true; },
    readRoomIdentity: function () { actions.push("readRoomIdentity"); return { roomKey: "douyin:test-room", text: "抖音号：test-room" }; },
    claimRoom: function () { actions.push("claimRoom"); return { acquired: true, roomKey: "douyin:test-room" }; },
    closeAnchorProfile: function () { actions.push("closeAnchorProfile"); return true; },
    releaseRoom: function () { actions.push("releaseRoom"); return { released: true }; },
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
test("workflow filters a qualifying room then waits for stop", function () {
  var entered = false;
  var stopRequested = false;
  var waitCount = 0;
  var captureCalls = 0;
  var cleanupCalls = 0;
  var runtime = runtimeFixture({
    detectPlatformVerification: function () { throw new Error("verification must not run"); },
    isLiveRoom: function () { entered = true; return true; },
    readViewerCount: function () { runtime.actions.push("readViewerCount"); return { count: 350 }; },
    waitRandom: function () {
      waitCount += 1;
      if (waitCount >= 20) {
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
  assert.equal(result.status, "LIVE_COMMENT_ENTRY_CAPTURED");
  assert.equal(runtime.actions.includes("readViewerCount"), true);
  assert.equal(runtime.actions.includes("nextLive"), false);
  assert.equal(captureCalls, 1);
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
test("workflow switches rooms until the viewer threshold is met", function () {
  var counts = [8500, 12000];
  var switches = 0;
  var waitCalls = 0;
  var stopRequested = false;
  var runtime = runtimeFixture({
    readViewerCount: function () { runtime.actions.push("readViewerCount"); return { count: counts.shift() }; },
    nextLive: function () { switches += 1; runtime.actions.push("nextLive"); return true; },
    waitRandom: function () {
      waitCalls += 1;
      if (waitCalls >= 6) stopRequested = true;
      runtime.actions.push("waitRandom");
      return true;
    }
  });
  var result = feature("workflow").createIsolatedLiveCommentWorkflow({ runtime: runtime }).run(
    { targetKeyword: "关键词", minViewerCount: 10000, maxRoomAttempts: 3 },
    { shouldStop: function () { return stopRequested; } }
  );
  assert.equal(result.status, "STOPPED");
  assert.equal(switches, 1);
  assert.equal(runtime.actions.filter(function (item) { return item === "readViewerCount"; }).length, 2);
});
test("workflow reports NO_ROOM_MATCHED at the configured room limit", function () {
  var switches = 0;
  var runtime = runtimeFixture({
    readViewerCount: function () { return { count: null }; },
    nextLive: function () { switches += 1; return true; },
    waitRandom: function () { return true; }
  });
  var result = feature("workflow").createIsolatedLiveCommentWorkflow({ runtime: runtime }).run(
    { targetKeyword: "关键词", minViewerCount: 300, maxRoomAttempts: 3 },
    { shouldStop: function () { return false; } }
  );
  assert.equal(result.status, "LIVE_COMMENT_ENTRY_FAILED");
  assert.equal(result.reasonCode, "NO_ROOM_MATCHED");
  assert.equal(result.attemptedRoomCount, 3);
  assert.equal(switches, 2);
});
test("workflow stops immediately when the room switch receives a stop request", function () {
  var stopped = false;
  var runtime = runtimeFixture({
    readViewerCount: function () { return { count: 1 }; },
    nextLive: function () { stopped = true; return true; },
    waitRandom: function () { return true; }
  });
  var result = feature("workflow").createIsolatedLiveCommentWorkflow({ runtime: runtime }).run(
    { targetKeyword: "关键词", minViewerCount: 300 },
    { shouldStop: function () { return stopped; } }
  );
  // roomProfiles 是后续新增的直播间画像回传字段，即使没有进过房间也会返回空数组。
  assert.deepEqual(result, { status: "STOPPED", roomProfiles: [] });
});
test("workflow extracts paged comments and returns backend-compatible sources", function () {
  var clock = 0;
  var pages = ["甲：重复评论\n欢迎来到直播间", "乙：第二条\n甲：重复评论", "丙：第三条\n欢迎来到直播间", "丁：" + "超长".repeat(101)];
  var pageIndex = 0;
  var swipes = 0;
  var runtime = runtimeFixture({
    readViewerCount: function () { return { count: 500 }; },
    readComments: function () { return { text: pages[pageIndex++] || "" }; },
    swipeComments: function () { swipes += 1; if (swipes === 3) clock += 300000; return true; },
    waitRandom: function () { return true; }
  });
  var result = feature("workflow").createIsolatedLiveCommentWorkflow({ runtime: runtime, deviceId: "device-1", now: function () { return clock; } }).run(
    { targetKeyword: "关键词", minViewerCount: 300, batchId: "batch-1", roomKey: "room-1", commentSwipeCount: 3 },
    { shouldStop: function () { return false; } }
  );
  assert.equal(result.captureStatus, "LIVE_COMMENT_ENTRY_CAPTURED");
  assert.equal(swipes, 3);
  assert.deepEqual(result.comments.map(function (item) { return item.commentText; }), ["重复评论", "第二条", "重复评论", "第三条"]);
  assert.deepEqual(result.comments[0].sources[0], {
    deviceId: "device-1", roomKey: "douyin:test-room", pageIndex: 0, commentText: "重复评论"
  });
});
test("workflow returns partial comments when stopped during comment paging", function () {
  var stopped = false;
  var swipes = 0;
  var runtime = runtimeFixture({
    readViewerCount: function () { return { count: 500 }; },
    readComments: function () { return { text: "甲：已抓到" }; },
    swipeComments: function () { swipes += 1; stopped = true; return true; },
    waitRandom: function () { return true; }
  });
  var result = feature("workflow").createIsolatedLiveCommentWorkflow({ runtime: runtime, deviceId: "device-1" }).run(
    { targetKeyword: "关键词", minViewerCount: 300, batchId: "batch-1", roomKey: "room-1", commentSwipeCount: 3 },
    { shouldStop: function () { return stopped; } }
  );
  assert.equal(result.status, "STOPPED");
  assert.equal(result.captureCompleted, false);
  assert.equal(result.comments[0].commentText, "已抓到");
  assert.equal(swipes, 1);
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
  var filterRecycled = 0;
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
      },
      nextVideo: function () { events.push("nextVideo"); }
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
    images: {
      clip: function (image, x, y, w, h) {
        requestedRegions.push({ x: x, y: y, w: w, h: h });
        return { text: ocrText.shift(), recycle: function () { clipRecycled += 1; } };
      },
      cvtColor: function (image) { return { source: image, recycle: function () { filterRecycled += 1; } }; },
      inRange: function (image) { return { text: image.source.text, recycle: function () { filterRecycled += 1; } }; }
    },
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
  assert.equal(requestedRegions.length, 2);
  assert.equal(screenRecycled, 3);
  assert.equal(clipRecycled, 2);
  assert.equal(filterRecycled, 2);
  assert.equal(diagnosticRecycled, 1);
  assert.equal(events.indexOf("openLiveRoomFromCurrentScreen") >= 0, true);
  assert.deepEqual(events.slice(-2), ["swipe", "nextVideo"]);
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
  assert.equal(failureRecycles, 2);
  assert.equal(failureClips, 1);
});
test("workflow identifies and claims a qualifying room before comment capture", function () {
  var received = [];
  var waits = [];
  var runtime = runtimeFixture({
    readViewerCount: function () { runtime.actions.push("readViewerCount"); return { count: 500, commerceCartVisible: false }; },
    waitRandom: function (min, max) { waits.push([min, max]); runtime.actions.push("waitRandom"); return true; }
  });
  var output = runIsolated(runtime, { targetKeyword: "关键词", minViewerCount: 300 }, received);
  assert.equal(output.result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.deepEqual(runtime.actions.filter(function (action) {
    return ["openAnchorSummary", "openAnchorProfile", "readRoomIdentity", "claimRoom", "closeAnchorProfile"].indexOf(action) >= 0;
  }), ["openAnchorSummary", "openAnchorProfile", "readRoomIdentity", "claimRoom", "closeAnchorProfile"]);
  assert.equal(waits.filter(function (range) { return range[0] === 5000 && range[1] === 7000; }).length, 4);
  assert.equal(received[0].roomKey, "douyin:test-room");
});
test("workflow skips a room claimed by another device and retries the next room", function () {
  var claims = 0;
  var switches = 0;
  var received = [];
  var waits = [];
  var runtime = runtimeFixture({
    readViewerCount: function () { return { count: 500, commerceCartVisible: false }; },
    claimRoom: function () {
      claims += 1;
      return claims === 1 ? { acquired: false, ownerDeviceId: "device-2" } : { acquired: true, roomKey: "douyin:next-room" };
    },
    readRoomIdentity: function () { return { roomKey: claims ? "douyin:next-room" : "douyin:busy-room" }; },
    nextLive: function () { switches += 1; return true; },
    waitRandom: function (min, max) { waits.push([min, max]); return true; }
  });
  var output = runIsolated(runtime, { targetKeyword: "关键词", minViewerCount: 300, maxRoomAttempts: 3 }, received);
  assert.equal(output.result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.equal(claims, 2);
  assert.equal(switches, 1);
  assert.equal(received[0].roomKey, "douyin:next-room");
  assert.equal(waits.filter(function (range) { return range[0] === 5000 && range[1] === 7000; }).length, 9);
});

test("workflow continues to the next room after one comment capture", function () {
  var stopRequested = false;
  var captures = 0;
  var runtime = runtimeFixture({
    readViewerCount: function () { return { count: 500, commerceCartVisible: false }; },
    nextLive: function () { runtime.actions.push("nextLive"); stopRequested = true; return true; },
    waitRandom: function () { runtime.actions.push("waitRandom"); return true; }
  });
  var workflow = feature("workflow").createIsolatedLiveCommentWorkflow({
    runtime: runtime,
    continueAfterCapture: true,
    commentRunner: { capture: function () {
      captures += 1;
      return { status: "LIVE_COMMENT_ENTRY_CAPTURED", comments: [{ commentText: "评论词" }] };
    } }
  });
  var result = workflow.run({ targetKeyword: "关键词", minViewerCount: 300 }, {
    shouldStop: function () { return stopRequested; }
  });
  assert.equal(captures, 1);
  assert.equal(runtime.actions.filter(function (item) { return item === "nextLive"; }).length, 1);
  assert.equal(result.status, "STOPPED");
  assert.equal(result.comments.length, 1);
});
test("runtime passes the active stop control into the first live click action", function () {
  var receivedControl = null;
  var control = { shouldStop: function () { return false; } };
  var runtime = feature("runtime").createIsolatedRuntime({
    douyin: {
      clickFirstLiveByRandomArea: function (activeControl) {
        receivedControl = activeControl;
        return true;
      }
    }
  }, { control: control });

  assert.equal(runtime.openFirstLive().success, true);
  assert.strictEqual(receivedControl, control);
});
test("runtime uses the approved profile regions and derives the room key from OCR", function () {
  var taps = [];
  var clips = [];
  var recycled = 0;
  var runtime = feature("runtime").createIsolatedRuntime({}, {
    control: { shouldStop: function () { return false; } },
    screenSize: { width: 1080, height: 2248 },
    random: function (min) { return min; },
    sleep: function () {},
    captureScreen: function () { return { recycle: function () { recycled += 1; } }; },
    images: { clip: function (image, x, y, width, height) {
      clips.push({ x: x, y: y, width: width, height: height });
      return { level: clips.length, recycle: function () { recycled += 1; } };
    } },
    ocrEngine: { recognize: function () { return "花姐讲种植\n抖音号："; } },
    accessibility: { createGestureDriver: function () { return {
      tap: function (point) { taps.push(point); return { success: true }; }
    }; } }
  });
  assert.equal(runtime.openAnchorSummary().success, true);
  assert.equal(runtime.openAnchorProfile().success, true);
  assert.equal(runtime.closeAnchorProfile().success, true);
  var identity = runtime.readRoomIdentity();
  assert.equal(identity.success, true);
  assert.equal(identity.value.roomKey, "anchor:花姐讲种植");
  assert.equal(identity.value.accountName, "花姐讲种植");
  assert.equal(identity.value.accountId, "");
  assert.deepEqual(taps.map(function (point) { return [point.x, point.y]; }), [[61, 119], [81, 1226], [54, 131]]);
  assert.deepEqual(clips, [
    { x: 12, y: 207, width: 1031, height: 819 },
    { x: 346, y: 115, width: 658, height: 134 }
  ]);
  assert.equal(recycled, 3);
});
test("runtime logs the legacy viewer and commerce-cart scans with execution status", function () {
  var logs = [];
  var runtime = feature("runtime").createIsolatedRuntime({
    logger: {
      info: function (message, details) { logs.push({ level: "info", message: message, details: details }); },
      warn: function (message, details) { logs.push({ level: "warn", message: message, details: details }); },
      error: function (message, details) { logs.push({ level: "error", message: message, details: details }); }
    },
    ocrEngine: { recognize: function () { return "在线 88 人"; } },
    viewerCountParser: { parseViewerBadgeCount: function () { return 88; } }
  }, {
    control: { shouldStop: function () { return false; } },
    screenSize: function () { return { width: 1080, height: 2248 }; },
    captureScreen: function () { return { recycle: function () {} }; },
    images: { clip: function () { return { recycle: function () {} }; } }
  });

  var result = runtime.readViewerCount();
  assert.equal(result.success, true);
  assert.equal(logs.some(function (entry) {
    return entry.message === "抓取评论词旧 OCR 人数扫描开始" &&
      entry.details.viewerOcrExecuted === true;
  }), true);
  assert.equal(logs.some(function (entry) {
    return entry.message === "抓取评论词旧 OCR 小黄车扫描完成" &&
      entry.details.commerceCartScanExecuted === true;
  }), true);
});

test("workflow logs each new profile step and wait range", function () {
  var logs = [];
  var runtime = runtimeFixture({
    readViewerCount: function () { return { count: 500, commerceCartVisible: false }; }
  });
  var output = runIsolated(runtime, { targetKeyword: "关键词", minViewerCount: 300 }, [], {
    logger: {
      info: function (message, details) { logs.push({ message: message, details: details }); },
      warn: function (message, details) { logs.push({ message: message, details: details }); },
      error: function (message, details) { logs.push({ message: message, details: details }); }
    }
  });
  assert.equal(output.result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.equal(logs.some(function (entry) {
    return entry.message === "抓取评论词新流程等待开始" &&
      entry.details.minMs === 5000 && entry.details.maxMs === 7000 &&
      entry.details.purpose === "点击主播信息前等待";
  }), true);
  assert.equal(logs.some(function (entry) {
    return entry.message === "抓取评论词主播身份 OCR 读取结果" &&
      entry.details.executed === true;
  }), true);
  assert.equal(logs.some(function (entry) {
    return entry.message === "抓取评论词主播身份占用判断完成";
  }), true);
});
test("public cleanup performs exact recents order and falls back safely", function () {
  var events = [];
  var lifecycleCalls = 0;
  var cleanup = cleanupModule.createDouyinPostPublishCleanup({
    cooldownMs: 0,
    openRecents: function () { events.push("recents"); return true; },
    getCurrentPackage: function () { return "com.miui.home"; },
    findDouyinCard: function () { events.push("find:douyin"); return {}; },
    dismissCard: function () { events.push("left-dismiss"); return true; },
    findAgentCard: function () { events.push("find:agent"); return {}; },
    openAgentCard: function () { events.push("open:agent"); return true; },
    wait: function () {}
  });
  var lifecycle = { beforeReturnToAgent: function () { lifecycleCalls += 1; events.push("lifecycle"); } };
  var first = cleanup.run({ taskId: "task-1" }, lifecycle);
  assert.deepEqual(events, ["recents", "find:douyin", "left-dismiss", "lifecycle", "find:agent", "open:agent"]);
  assert.equal(first.completed, true);
  assert.equal(lifecycleCalls, 1);
  var fallbackEvents = [];
  var fallback = cleanupModule.createDouyinPostPublishCleanup({
    cooldownMs: 0,
    openRecents: function () { return false; },
    goHome: function () { fallbackEvents.push("home"); return true; },
    findAgentHomeIcon: function () { return null; },
    openAgentByPackage: function () { fallbackEvents.push("package"); return true; },
    wait: function () {}
  }).run({}, { beforeReturnToAgent: function () { fallbackEvents.push("lifecycle"); } });
  assert.equal(fallback.completed, true);
  assert.equal(fallback.fallback, "PACKAGE");
  assert.deepEqual(fallbackEvents, ["home", "package"]);
  var stable = cleanupModule.createDouyinPostPublishCleanup({
    cooldownMs: 0,
    openRecents: function () { return false; },
    goHome: function () { return false; },
    openAgentByPackage: function () { return false; }
  }).run({});
  assert.equal(stable.completed, false);
  assert.equal(stable.reason, "HOME_FALLBACK_FAILED");
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
