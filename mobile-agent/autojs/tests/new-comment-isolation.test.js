"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var workflowModule = require("../features/new-comment/workflow.js");

var featureRoot = path.join(__dirname, "../features/new-comment");
var requiredFiles = ["runtime.js", "workflow.js", "cleanup.js", "index.js"];

function stoppingControl(stopAfter) {
  var calls = 0;
  return {
    shouldStop: function () {
      calls += 1;
      return calls > stopAfter;
    },
    calls: function () { return calls; }
  };
}

function openRuntime(waitRandom) {
  return {
    openDouyin: function () { return true; },
    openSearch: function () { return true; },
    openLiveTab: function () { return true; },
    openFirstLive: function () { return true; },
    waitRandom: waitRandom
  };
}

test("isolated workflow production modules exist", function () {
  requiredFiles.forEach(function (name) {
    assert.equal(fs.existsSync(path.join(featureRoot, name)), true, name + " must exist");
  });
});

test("workflow enters the first room, then waits for a stop command", function () {
  var waits = 0;
  var stages = [];
  var control = stoppingControl(20);
  var runtime = openRuntime(function () { waits += 1; return true; });
  var result = workflowModule.createIsolatedLiveCommentWorkflow({
    runtime: runtime,
    reportStage: function (event) { stages.push(event.stage); }
  }).run({ targetKeyword: "关键词" }, control);

  assert.deepEqual(result, { status: "STOPPED" });
  assert.equal(stages.includes("ENTERED"), true);
  assert.equal(waits, 5);
});

test("workflow stops before opening any room when already requested", function () {
  var calls = 0;
  var result = workflowModule.createIsolatedLiveCommentWorkflow({
    runtime: { openDouyin: function () { calls += 1; return true; } }
  }).run({}, { shouldStop: function () { return true; } });

  assert.deepEqual(result, { status: "STOPPED" });
  assert.equal(calls, 0);
});

test("waitForStop falls back to a real sleep when waitRandom is unavailable", function () {
  var sleeps = [];
  var control = stoppingControl(20);
  var runtime = openRuntime(undefined);
  runtime.sleep = function (milliseconds) { sleeps.push(milliseconds); };
  var result = workflowModule.createIsolatedLiveCommentWorkflow({ runtime: runtime })
    .run({ targetKeyword: "关键词" }, control);

  assert.deepEqual(result, { status: "STOPPED" });
  assert.ok(sleeps.length >= 1);
  sleeps.forEach(function (milliseconds) {
    assert.ok(milliseconds >= 500 && milliseconds <= 800);
  });
});

test("waitForStop falls back to a real sleep when waitRandom throws", function () {
  var sleeps = [];
  var waitCalls = 0;
  var control = stoppingControl(20);
  var runtime = openRuntime(function () {
    waitCalls += 1;
    if (waitCalls > 4) throw new Error("timer unavailable");
    return true;
  });
  runtime.sleep = function (milliseconds) { sleeps.push(milliseconds); };
  var result = workflowModule.createIsolatedLiveCommentWorkflow({ runtime: runtime })
    .run({ targetKeyword: "关键词" }, control);

  assert.deepEqual(result, { status: "STOPPED" });
  assert.ok(sleeps.length >= 1);
  sleeps.forEach(function (milliseconds) {
    assert.ok(milliseconds >= 500 && milliseconds <= 800);
  });
});

test("new-comment source remains synchronous and portable", function () {
  fs.readdirSync(featureRoot).filter(function (name) { return /\.js$/.test(name); }).forEach(function (name) {
    var source = fs.readFileSync(path.join(featureRoot, name), "utf8");
    var lineCount = source.replace(/\r\n/g, "\n").split("\n").length;
    assert.ok(lineCount <= 400, name + " has " + lineCount + " lines");
    assert.doesNotMatch(source, /\basync\b|\bPromise\b/, name + " is not synchronous ES5");
    assert.doesNotMatch(source, /require\(["']node:|\bprocess\.|\bBuffer\b/, name + " uses a Node-only API");
  });
});
