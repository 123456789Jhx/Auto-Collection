"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
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

test("isolated workflow production modules exist", function () {
  requiredFiles.forEach(function (name) {
    assert.equal(fs.existsSync(path.join(featureRoot, name)), true, name + " must exist");
  });
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
