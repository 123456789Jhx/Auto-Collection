"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var runtimeModule = require("../features/new-comment/runtime.js");
var workflowModule = require("../features/new-comment/workflow.js");

function control() {
  return { shouldStop: function () { return false; } };
}

function recognizer(recycled) {
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

test("missing risk detector fails closed with diagnostics before later workflow actions", function () {
  var recycled = { count: 0 };
  var searchCalls = 0;
  var runtime = runtimeModule.createIsolatedRuntime({
    douyin: {
      openApp: function () { return true; },
      openSearch: function () { searchCalls += 1; return true; }
    },
    screenRecognizer: recognizer(recycled)
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

test("throwing risk detector fails closed and keeps already captured diagnostics", function () {
  var recycled = { count: 0 };
  var runtime = runtimeModule.createIsolatedRuntime({
    screenRecognizer: recognizer(recycled),
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
