"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var cleanupModule = require("../features/new-comment/cleanup.js");
var layout = require("../features/new-comment/douyin-layout.js");
var runtimeModule = require("../features/new-comment/runtime.js");
var workflowModule = require("../features/new-comment/workflow.js");

var featureRoot = path.join(__dirname, "../features/new-comment");
var requiredFiles = ["runtime.js", "workflow.js", "cleanup.js", "index.js"];

function productionFiles() {
  return fs.readdirSync(featureRoot).filter(function (name) { return /\.js$/.test(name); }).map(function (name) {
    return { name: name, source: fs.readFileSync(path.join(featureRoot, name), "utf8") };
  });
}

function control() {
  return { shouldStop: function () { return false; } };
}

function explicitRecognizer(recycled) {
  return {
    extractFastText: function () {
      return {
        image: { recycle: function () { recycled.count += 1; } },
        combinedText: "请完成安全验证",
        visibleStructure: { title: "安全验证" }
      };
    }
  };
}

function assertDiagnostics(result) {
  assert.equal(result.details.textSample, "请完成安全验证");
  assert.deepEqual(result.details.pageStructure, { title: "安全验证" });
  assert.deepEqual(result.details.visibleStructure, { title: "安全验证" });
  assert.ok(result.details.actionTrace.includes("detectPlatformVerification"));
}

function runViewerGate(detectPlatformVerification) {
  var state = { read: false, nextCalls: 0 };
  var pass = function () { return true; };
  var runtime = {
    openDouyin: pass, openSearch: pass, openLiveTab: pass, openFirstLive: pass,
    waitRandom: pass, isLiveRoom: pass,
    readViewerCount: function () { state.read = true; return { count: 1, source: "ocr" }; },
    nextLive: function () { state.nextCalls += 1; return true; },
    detectPlatformVerification: function () { return detectPlatformVerification(state); }
  };
  state.result = workflowModule.createIsolatedLiveCommentWorkflow({
    runtime: runtime,
    commentRunner: { capture: function () { return { status: "LIVE_COMMENT_ENTRY_ENTERED" }; } }
  }).run({ targetKeyword: "药材种植", minViewerCount: 10, maxCandidateRooms: 2 }, control());
  return state;
}

test("isolated workflow production modules exist", function () {
  requiredFiles.forEach(function (name) {
    assert.equal(fs.existsSync(path.join(featureRoot, name)), true, name + " must exist");
  });
});

test("viewer and ended OCR regions exactly match the legacy 1080x2400 geometry", function () {
  var size = { width: 1080, height: 2400 };
  assert.deepEqual(layout.getRegion("liveEnded", size),
    { name: "liveEnded", left: 345, top: 144, width: 411, height: 132 });
  assert.deepEqual(layout.getRegion("viewerCount", size),
    { name: "viewerCount", left: 642, top: 144, width: 346, height: 137 });
});

test("verification appearing immediately after viewer OCR prevents next-live actions", function () {
  var state = runViewerGate(function (current) {
    return current.read ? { detected: true, reasonCode: "PLATFORM_VERIFICATION" } : { detected: false };
  });
  assert.equal(state.result.status, "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION");
  assert.equal(state.nextCalls, 0);
});

test("real runtime treats a missing first live result as retryable search state", function () {
  var attempts = 0;
  var searches = 0;
  var stages = [];
  var runtime = runtimeModule.createIsolatedRuntime({
    douyin: {
      openApp: function () { return true; },
      openSearch: function () { searches += 1; return true; },
      openLiveTab: function () { return true; },
      openLiveRoomFromCurrentScreen: function () { attempts += 1; return attempts > 1; },
      isLiveRoomVisible: function () { return true; }
    },
    riskDetector: { detectRisk: function () { return { detected: false }; } },
    screenRecognizer: { extractFastText: function () { return null; } }
  }, { control: control(), sleep: function () { return true; } });
  var result = workflowModule.createIsolatedLiveCommentWorkflow({
    runtime: runtime,
    reportStage: function (event) { stages.push(event.stage); },
    commentRunner: { capture: function () { return { status: "LIVE_COMMENT_ENTRY_ENTERED" }; } }
  }).run({ targetKeyword: "药材种植" }, control());

  assert.equal(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.equal(attempts, 2);
  assert.equal(searches, 2);
  assert.ok(stages.includes("RETRYING_SEARCH"));
});

test("cleanup idempotency is isolated by task identity and bounded", function () {
  var recentsCalls = 0;
  var lifecycleCalls = 0;
  var cleanup = cleanupModule.createIsolatedCleanup({}, {
    isDouyinForeground: function () { return true; },
    openRecents: function () { recentsCalls += 1; return true; },
    findDouyinCard: function () { return {}; },
    dismissCard: function () { return true; },
    findAgentCard: function () { return {}; },
    openAgentCard: function () { return true; },
    wait: function () {}, recentsReadyWaitMs: 0
  });
  function lifecycle() {
    return { beforeReturnToAgent: function () { lifecycleCalls += 1; } };
  }

  assert.equal(cleanup.run({ batchId: "batch-a", taskId: "shared" }, lifecycle()).cached, undefined);
  assert.equal(cleanup.run({ batchId: "batch-a", taskId: "other" }, lifecycle()).cached, true);
  assert.equal(cleanup.run({ batchId: "batch-b", taskId: "shared" }, lifecycle()).cached, undefined);
  assert.equal(cleanup.run({ taskId: "task-c" }, lifecycle()).cached, undefined);
  assert.equal(cleanup.run({ taskId: "task-c" }, lifecycle()).cached, true);
  assert.equal(recentsCalls, 3);
  assert.equal(lifecycleCalls, 3);

  var boundedCalls = 0;
  var bounded = cleanupModule.createIsolatedCleanup({}, {
    isDouyinForeground: function () { return false; }, isRecentsPackage: function () { return true; },
    openRecents: function () { boundedCalls += 1; return true; }, findDouyinCard: function () { return {}; },
    dismissCard: function () { return true; }, findAgentCard: function () { return {}; },
    openAgentCard: function () { return true; }, wait: function () {}, recentsReadyWaitMs: 0
  });
  var index;
  for (index = 0; index < 22; index += 1) bounded.run({ taskId: "bounded-" + index });
  assert.equal(bounded.run({ taskId: "bounded-21" }).cached, true);
  assert.equal(bounded.run({ taskId: "bounded-0" }).cached, undefined);
  assert.equal(boundedCalls, 23);
});

test("workflow passes task identity and control into final cleanup", function () {
  var capturedPayload;
  var capturedLifecycle;
  var activeControl = control();
  var pass = function () { return true; };
  var result = workflowModule.createIsolatedLiveCommentWorkflow({
    runtime: { openDouyin: pass, openSearch: pass, openLiveTab: pass, openFirstLive: pass,
      isLiveRoom: pass, waitRandom: pass,
      detectPlatformVerification: function () { return { detected: false }; } },
    commentRunner: { capture: function () { return { status: "LIVE_COMMENT_ENTRY_ENTERED" }; } },
    finalCleanup: { run: function (payload, lifecycle) {
      capturedPayload = payload;
      capturedLifecycle = lifecycle;
      return { completed: true };
    } }
  }).run({ batchId: "batch-9", taskId: "task-4", targetKeyword: "药材种植" }, activeControl);

  assert.equal(result.status, "LIVE_COMMENT_ENTRY_ENTERED");
  assert.equal(capturedPayload.batchId, "batch-9");
  assert.equal(capturedPayload.taskId, "task-4");
  assert.equal(capturedPayload.control, activeControl);
  assert.equal(capturedLifecycle.control, activeControl);
});

test("capture verification keeps cleanup required when cleanup fails", function () {
  var pass = function () { return true; };
  var result = workflowModule.createIsolatedLiveCommentWorkflow({
    runtime: { openDouyin: pass, openSearch: pass, openLiveTab: pass, openFirstLive: pass,
      isLiveRoom: pass, waitRandom: pass,
      detectPlatformVerification: function () { return { detected: false }; } },
    commentRunner: { capture: function () { return {
      status: "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION",
      capturePlatformVerification: true,
      cleanupRequired: true
    }; } },
    finalCleanup: { run: function () { return {
      completed: false, reason: "HOME_FALLBACK_FAILED"
    }; } }
  }).run({ batchId: "batch-verification", targetKeyword: "药材种植" }, control());

  assert.equal(result.status, "LIVE_COMMENT_ENTRY_CAPTURE_PLATFORM_VERIFICATION");
  assert.equal(result.cleanupAttempted, true);
  assert.equal(result.cleanupFailed, true);
  assert.equal(result.cleanupRequired, true);
});

test("cleanup only dismisses inside confirmed recents and supports UiCollection", function () {
  var waits = [];
  var dismisses = 0;
  var foreground = [true, true];
  var unsafe = cleanupModule.createIsolatedCleanup({}, {
    isDouyinForeground: function () { return foreground.shift(); },
    isRecentsPackage: function () { return true; },
    openRecents: function () { return true; },
    findCenteredTaskCard: function () { return {}; },
    findDouyinCard: function () { return {}; },
    dismissCard: function () { dismisses += 1; return true; },
    goHome: function () { return true; }, findAgentHomeIcon: function () { return null; },
    openAgentByPackage: function () { return true; },
    wait: function (milliseconds) { waits.push(milliseconds); }
  }).run({ taskId: "unsafe" });
  assert.equal(dismisses, 0);
  assert.equal(unsafe.reason, "RECENTS_NOT_READY");
  assert.ok(waits.some(function (milliseconds) { return milliseconds > 0; }));

  var previousId = global.id;
  try {
    var nodes = [{ bounds: function () { return { left: 20, right: 520, top: 400, bottom: 1800 }; } },
      { bounds: function () { return { left: 290, right: 790, top: 400, bottom: 1800 }; } }];
    global.id = function () { return { find: function () { return {
      size: function () { return nodes.length; }, get: function (index) { return nodes[index]; }
    }; } }; };
    var activeForeground = [true, false];
    var dismissed;
    var zeroWaits = [];
    var safe = cleanupModule.createIsolatedCleanup({}, {
      screenSize: { width: 1080, height: 2400 },
      isDouyinForeground: function () { return activeForeground.shift(); },
      isRecentsPackage: function () { return false; }, openRecents: function () { return true; },
      findDouyinCard: function () { return null; },
      dismissCard: function (card) { dismissed = card; return true; },
      findAgentCard: function () { return {}; }, openAgentCard: function () { return true; },
      recentsReadyWaitMs: 0, wait: function (milliseconds) { zeroWaits.push(milliseconds); }
    }).run({ taskId: "collection" });
    assert.equal(safe.completed, true);
    assert.equal(dismissed, nodes[1]);
    assert.deepEqual(zeroWaits, []);
  } finally { global.id = previousId; }
});

test("cleanup rechecks stop before every wait", function () {
  var stopped = false;
  var waits = [];
  var foreground = [true, false];
  var result = cleanupModule.createIsolatedCleanup({}, {
    cooldownMs: 10, recentsReadyWaitMs: 20, agentCardReadyWaitMs: 30,
    wait: function (milliseconds) { waits.push(milliseconds); stopped = true; },
    isDouyinForeground: function () { return foreground.shift(); },
    isRecentsPackage: function () { return true; }, openRecents: function () { return true; },
    findCenteredTaskCard: function () { return {}; }, findDouyinCard: function () { return {}; },
    dismissCard: function () { return true; }, findAgentCard: function () { return {}; },
    openAgentCard: function () { return true; }
  }).run({ taskId: "stop-waits", control: {
    shouldStop: function () { return stopped; }
  } });
  assert.equal(result.completed, true);
  assert.deepEqual(waits, [10]);
});

test("new-comment production requires only sibling modules or public core adapters", function () {
  productionFiles().forEach(function (file) {
    assert.doesNotMatch(file.source, /account-warmup|publish-video|domain[\\/]live-comment/,
      file.name + " imports a legacy business module");
    var requires = file.source.matchAll(/require\(["']([^"']+)["']\)/g);
    Array.from(requires).forEach(function (match) {
      assert.match(match[1], /^(\.\/|\.\.\/\.\.\/core\/)/,
        file.name + " imports non-public business code: " + match[1]);
    });
  });
});

test("workflow and runner never call AutoJS gesture, selector or capture globals", function () {
  ["workflow.js", "comment-runner.js"].forEach(function (name) {
    var source = fs.readFileSync(path.join(featureRoot, name), "utf8");
    assert.doesNotMatch(source, /\b(?:click|swipe|text|desc|captureScreen)\s*\(/,
      name + " contains a raw AutoJS call");
  });
});

test("every new-comment source stays synchronous, portable and at most 400 lines", function () {
  productionFiles().forEach(function (file) {
    var lineCount = file.source.replace(/\r\n/g, "\n").split("\n").length;
    assert.ok(lineCount <= 400, file.name + " has " + lineCount + " lines");
    assert.doesNotMatch(file.source, /\basync\b|\bPromise\b/,
      file.name + " is not synchronous ES5");
    assert.doesNotMatch(file.source, /require\(["']node:|\bprocess\.|\bBuffer\b/,
      file.name + " uses a Node-only API");
  });
});

test("missing risk detector fails closed with diagnostics before later workflow actions", function () {
  var recycled = { count: 0 };
  var searchCalls = 0;
  var runtime = runtimeModule.createIsolatedRuntime({
    douyin: {
      openApp: function () { return true; },
      openSearch: function () { searchCalls += 1; return true; }
    },
    screenRecognizer: explicitRecognizer(recycled)
  }, { control: control() });

  var detection = runtime.detectPlatformVerification();
  assert.equal(detection.success, false);
  assert.equal(detection.reason, "DEPENDENCY_MISSING");
  assertDiagnostics(detection);

  var result = workflowModule.createIsolatedLiveCommentWorkflow({ runtime: runtime }).run(
    { targetKeyword: "药材种植" }, control()
  );
  assert.equal(result.status, "LIVE_COMMENT_ENTRY_FAILED");
  assert.equal(result.reasonCode, "DEPENDENCY_MISSING");
  assert.equal(searchCalls, 0);
  assert.deepEqual(result.verificationDiagnostics.pageStructure, { title: "安全验证" });
  assert.equal(recycled.count, 2);
});

test("throwing risk detector fails closed and keeps explicit diagnostics", function () {
  var recycled = { count: 0 };
  var runtime = runtimeModule.createIsolatedRuntime({
    screenRecognizer: explicitRecognizer(recycled),
    riskDetector: { detectRisk: function () { throw new Error("detector crashed"); } }
  }, { control: control() });

  var detection = runtime.detectPlatformVerification();
  assert.equal(detection.success, false);
  assert.equal(detection.reason, "VERIFICATION_CHECK_FAILED");
  assertDiagnostics(detection);
  assert.equal(recycled.count, 1);
});

test("missing detector branch honors stop before reading diagnostics", function () {
  var reads = 0;
  var runtime = runtimeModule.createIsolatedRuntime({
    screenRecognizer: { extractFastText: function () { reads += 1; return null; } }
  }, { control: { shouldStop: function () { return true; } } });

  var detection = runtime.detectPlatformVerification();
  assert.equal(detection.reason, "STOP_REQUESTED");
  assert.equal(reads, 0);
});

test("missing detector honors stop raised during diagnostics and recycles snapshot", function () {
  var stopped = false;
  var recycled = 0;
  var runtime = runtimeModule.createIsolatedRuntime({
    screenRecognizer: { extractFastText: function () {
      stopped = true;
      return { image: { recycle: function () { recycled += 1; } }, combinedText: "读取中停止" };
    } }
  }, { control: { shouldStop: function () { return stopped; } } });

  var detection = runtime.detectPlatformVerification();
  assert.deepEqual(detection, { success: false, reason: "STOP_REQUESTED", message: "task stopped" });
  assert.equal(recycled, 1);
});

test("real screen-recognizer snapshot becomes stable data-only diagnostics", function () {
  var recycled = 0;
  var snapshot = {
    currentPackageName: "com.ss.android.ugc.aweme",
    currentActivityName: "com.ss.android.ugc.aweme.search.activity.SearchResultActivity",
    visibleText: "直播\n药材种植",
    ocrText: "",
    ocrRegions: {},
    combinedText: "直播\n药材种植",
    image: { recycle: function () { recycled += 1; } },
    scene: "search_results",
    sceneReasons: ["search_tabs"],
    searchState: { isResult: true },
    capturedAt: "2026-08-27T12:00:00.000Z"
  };
  var runtime = runtimeModule.createIsolatedRuntime({
    screenRecognizer: { extractFastText: function () { return snapshot; } },
    riskDetector: { detectRisk: function () { throw new Error("detector crashed"); } }
  }, { control: control() });

  var detection = runtime.detectPlatformVerification();
  var expected = {
    capturedAt: snapshot.capturedAt,
    combinedText: snapshot.combinedText,
    currentActivityName: snapshot.currentActivityName,
    currentPackageName: snapshot.currentPackageName,
    ocrRegions: {},
    ocrText: "",
    scene: snapshot.scene,
    sceneReasons: ["search_tabs"],
    searchState: { isResult: true },
    visibleText: snapshot.visibleText
  };
  assert.deepEqual(detection.details.pageStructure, expected);
  assert.deepEqual(detection.details.visibleStructure, expected);
  assert.equal(Object.prototype.hasOwnProperty.call(detection.details.pageStructure, "image"), false);
  assert.equal(recycled, 1);
});
