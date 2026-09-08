"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var runtimeModule = require("../features/new-comment/runtime.js");
var runnerModule = require("../features/new-comment/comment-runner.js");

function loadFilter() {
  try {
    return require("../features/new-comment/comment-white-filter.js");
  } catch (error) {
    return null;
  }
}

test("comment OCR keeps near-white pixels with the approved HSV bounds", function () {
  var filter = loadFilter();
  assert.equal(typeof (filter && filter.preprocess), "function");
  var calls = [];
  var hsv = { recycle: function () { calls.push("recycle:hsv"); } };
  var mask = { recycle: function () { calls.push("recycle:mask"); } };
  var result = filter.preprocess({
    cvtColor: function (image, code) {
      calls.push(["cvtColor", image, code]);
      return hsv;
    },
    inRange: function (image, lower, upper) {
      calls.push(["inRange", image, lower, upper]);
      return mask;
    }
  }, { name: "comment-clip" }, {
    color: function (h, s, v) { return [h, s, v].join(":"); }
  });

  assert.equal(result.success, true);
  assert.strictEqual(result.image, mask);
  assert.deepEqual(calls, [
    ["cvtColor", { name: "comment-clip" }, "BGR2HSV"],
    ["inRange", hsv, "0:0:185", "180:55:255"],
    "recycle:hsv"
  ]);
});

test("comment OCR filter fails closed and recycles intermediate images", function () {
  var filter = loadFilter();
  assert.equal(typeof (filter && filter.preprocess), "function");
  var recycled = 0;
  var failed = filter.preprocess({ cvtColor: function () {
    return { recycle: function () { recycled += 1; } };
  }, inRange: function () { throw new Error("opencv failed"); } }, {});

  assert.equal(failed.success, false);
  assert.equal(failed.reason, "COMMENT_WHITE_FILTER_FAILED");
  assert.equal(recycled, 1);
  assert.equal(filter.preprocess({}, {}).reason, "COMMENT_WHITE_FILTER_UNAVAILABLE");
});

test("runtime sends only the near-white comment mask to OCR", function () {
  var recycled = [];
  function image(name) {
    return { name: name, recycle: function () { recycled.push(name); } };
  }
  var snapshot = image("snapshot");
  var clip = image("clip");
  var hsv = image("hsv");
  var mask = image("mask");
  var recognized = null;
  var runtime = runtimeModule.createIsolatedRuntime({}, {
    control: { shouldStop: function () { return false; } },
    screenSize: { width: 1080, height: 2248 },
    captureScreen: function () { return snapshot; },
    images: {
      clip: function () { return clip; },
      cvtColor: function () { return hsv; },
      inRange: function () { return mask; }
    },
    ocrEngine: { recognize: function (input) {
      recognized = input;
      return "用户：白色评论正文";
    } }
  });

  var result = runtime.readComments();
  assert.equal(result.success, true);
  assert.strictEqual(recognized, mask);
  assert.equal(result.value.text, "用户：白色评论正文");
  assert.deepEqual(recycled.sort(), ["clip", "hsv", "mask", "snapshot"]);
});

test("comment runner stores filtered OCR lines without separator parsing", function () {
  var runner = runnerModule.createCommentCaptureRunner({
    runtime: {
      readComments: function () { return { text: "第一条白色正文\n第二条白色正文" }; }
    },
    maxSwipeCount: 0,
    shouldStop: function () { return false; }
  });

  var result = runner.capture({
    batchId: "batch-white",
    deviceId: "device-white",
    roomKey: "room-white"
  }, { shouldStop: function () { return false; } });
  assert.deepEqual(result.comments.map(function (item) { return item.commentText; }), [
    "第一条白色正文",
    "第二条白色正文"
  ]);
});
