"use strict";
var assert = require("node:assert/strict");
var test = require("node:test");
var createRunner = require("../features/new-comment/comment-runner.js").createCommentCaptureRunner;
var createRuntime = require("../features/new-comment/runtime.js").createIsolatedRuntime;

function scenario(swipeResult, customize) {
  var clock = 0, reads = 0, swipes = 0, events = [];
  var runtime = {
    readComments: function () { reads += 1; return { text: "相同评论\n57条新消息" }; },
    swipeComments: function () { swipes += 1; clock += 2520; return swipeResult; },
    waitRandom: function (min) { clock += min; return true; }
  };
  var options = { runtime: runtime, captureDurationMinutes: 1, now: function () { return clock; },
    reportStage: function (event) { events.push(event); } };
  if (customize) customize(options, runtime, function (ms) { clock += ms; });
  var result = createRunner(options).capture({ batchId: "batch", deviceId: "device", roomKey: "room" });
  return { result: result, reads: reads, swipes: swipes, events: events, elapsed: clock };
}

test("first end banner ends capture after one swipe and preserves the collected page", function () {
  var run = scenario({ success: true, value: { endDetected: true, text: "没有更多信息了" } });
  assert.equal(run.result.captureStopReason, "COMMENT_HISTORY_END");
  assert.equal(run.swipes, 1);
  assert.equal(run.reads, 1);
  assert.equal(run.result.commentCount, 2);
  assert.equal(run.elapsed, 2520);
});

test("identical comments never end capture without the banner", function () {
  var run = scenario({ success: true, value: { endDetected: false } });
  assert.equal(run.result.captureStopReason, "DURATION_REACHED");
  assert.ok(run.swipes > 3);
  assert.equal(run.result.commentCount, run.reads * 2);
});

test("empty comment pages do not substitute for the history-end banner", function () {
  var run = scenario({ success: true, value: { endDetected: false } }, function (_, runtime) {
    runtime.readComments = function () { return { text: "" }; };
  });
  assert.equal(run.result.captureStopReason, "DURATION_REACHED");
  assert.equal(run.result.commentCount, 0);
  assert.ok(run.swipes > 3);
});

test("STOP and deadline during held OCR take priority over an end banner", function () {
  ["stop", "deadline"].forEach(function (mode) {
    var stop = false;
    var run = scenario(null, function (options, runtime, advance) {
      options.shouldStop = function () { return stop; };
      runtime.swipeComments = function () {
        if (mode === "stop") stop = true; else advance(60000);
        return { success: true, value: { endDetected: true } };
      };
    });
    assert.equal(mode === "stop" ? run.result.status : run.result.captureStopReason,
      mode === "stop" ? "STOPPED" : "DURATION_REACHED");
    assert.equal(run.result.commentCount, 2);
  });
});

test("held OCR failure stops as a failure and preserves prior comments", function () {
  var run = scenario({ success: false, reason: "COMMENT_END_OCR_FAILED", message: "camera unavailable" });
  assert.equal(run.result.reasonCode, "COMMENT_SWIPE_FAILED");
  assert.equal(run.result.captureStopReason, undefined);
  assert.equal(run.result.commentCount, 2);
});

function heldRuntime(text, overrides) {
  var held = false, now = 0, clips = [], recycled = [], samples = 0;
  var options = {
    screenSize: { width: 1080, height: 2248 }, sleep: function (ms) { now += ms; },
    random: function (min) { return min; },
    captureScreen: function () {
      assert.equal(held, true, "capture must occur before native release");
      samples += 1;
      return { recycle: function () { recycled.push("screen"); } };
    },
    images: { clip: function (_, x, y, width, height) {
      clips.push([x, y, width, height]);
      return { recycle: function () { recycled.push("clip"); } };
    } },
    ocrEngine: { recognize: function () { return text; } },
    gestureDriver: { swipeAndHold: function (input, inspect) {
      assert.deepEqual(input.points, [{ x: 279, y: 1607 }, { x: 245, y: 1880 }]);
      assert.deepEqual(input.controlPoint, { x: 282, y: 1690 });
      assert.equal(input.startHoldMs, 120);
      assert.equal(input.durationMs, 520);
      assert.equal(input.holdMs, 2000);
      held = true;
      try { return inspect(function () { return now < 2000; }); }
      finally { held = false; }
    } }
  };
  if (overrides) overrides(options, function (ms) { now += ms; });
  var result = createRuntime({}, options).swipeComments();
  return { result: result, clips: clips, recycled: recycled, samples: samples };
}

test("held runtime recognizes only the specified crop and recycles every image", function () {
  var run = heldRuntime("没有 更 多\n信息了 ~");
  assert.equal(run.result.success, true);
  assert.equal(run.result.value.endDetected, true);
  assert.deepEqual(run.clips, [[39, 1483, 346, 71]]);
  assert.deepEqual(run.recycled.sort(), ["clip", "screen"]);
});

test("each swipe logs the same random curve passed to the driver", function () {
  var geometryDraws = 0, timingDraws = 0, sizeReads = 0, dispatched = [], logged = [];
  var runtime = createRuntime({ logger: { info: function (message, data) {
    if (data.coordinates) logged.push(JSON.parse(JSON.stringify(data.coordinates)));
  } } }, {
    screenSize: function () { sizeReads += 1; return { width: 1080, height: 2248 }; },
    random: function (min, max) {
      if (min === 2500 && max === 4500) {
        timingDraws += 1;
        return min;
      }
      geometryDraws += 1;
      return geometryDraws <= 3 ? min : max;
    },
    captureScreen: function () {}, images: { clip: function () {} }, ocrEngine: { recognize: function () {} },
    gestureDriver: { swipeAndHold: function (input) {
      dispatched.push(input);
      return { success: true, value: { endDetected: false } };
    } }
  });
  runtime.swipeComments();
  runtime.swipeComments();
  assert.equal(geometryDraws, 6);
  assert.equal(timingDraws, 2);
  assert.equal(sizeReads, 2);
  assert.equal(logged.length, 2);
  assert.equal(logged[0].endX, 245);
  assert.equal(logged[1].endX, 338);
  logged.forEach(function (coordinates, index) {
    assert.deepEqual(dispatched[index].points, [
      { x: coordinates.startX, y: coordinates.startY }, { x: coordinates.endX, y: coordinates.endY }
    ]);
    assert.deepEqual(dispatched[index].controlPoint, coordinates.controlPoint);
    assert.equal(dispatched[index].startHoldMs, 120);
    assert.equal(dispatched[index].startHoldMs, coordinates.startHoldMs);
    assert.equal(dispatched[index].holdMs, 2000);
  });
});

test("new-message badges do not match the marker and inspection remains bounded", function () {
  var run = heldRuntime("57条新消息");
  assert.equal(run.result.success, true);
  assert.equal(run.result.value.endDetected, false);
  assert.ok(run.samples > 1 && run.samples <= 20);
  assert.equal(run.recycled.length, run.samples * 2);
});

test("end OCR errors release images and cannot masquerade as no marker", function () {
  var run = heldRuntime("", function (options) {
    options.ocrEngine.recognize = function () { throw new Error("OCR unavailable"); };
  });
  assert.equal(run.result.success, false);
  assert.deepEqual(run.recycled.sort(), ["clip", "screen"]);
});

test("an image returned after release is not used as held-frame evidence", function () {
  var run = heldRuntime("没有更多信息了", function (options, advance) {
    var capture = options.captureScreen;
    options.captureScreen = function () { var image = capture(); advance(2100); return image; };
    options.ocrEngine.recognize = function () { throw new Error("must not OCR a late frame"); };
  });
  assert.equal(run.result.success, false);
  assert.equal(run.result.reason, "COMMENT_END_CAPTURE_LATE");
  assert.deepEqual(run.recycled, ["screen"]);
});

test("a driver without hold capability cannot fall back to an ordinary swipe", function () {
  var runtime = createRuntime({}, { gestureDriver: { swipe: function () { throw new Error("must not swipe"); } } });
  assert.equal(runtime.swipeComments().success, false);
});

test("workflow switches two rooms after their first banner and resets capture state", function () {
  var room = 0, clock = 0, events = [];
  function ok() { return true; }
  var runtime = { openDouyin: ok, openSearch: ok, openLiveTab: ok, openFirstLive: ok,
    openAnchorSummary: ok, openAnchorProfile: ok, closeAnchorProfile: ok,
    readViewerCount: function () { return { count: 500, commerceCartVisible: false }; },
    readRoomIdentity: function () { return { text: "room " + room }; },
    readComments: function () { return { text: "same comment" }; },
    swipeComments: function () { return { success: true, value: { endDetected: true } }; },
    waitRandom: function (min) { clock += min; return true; },
    nextLive: function () { room += 1; return true; }
  };
  require("../features/new-comment/workflow.js").createIsolatedLiveCommentWorkflow({
    runtime: runtime, continueAfterCapture: true, now: function () { return clock; },
    reportStage: function (event) { if (event.stage === "COMMENTS_CAPTURED") events.push(event); }
  }).run({ targetKeyword: "crop", captureDurationMinutes: 1 }, { shouldStop: function () { return room === 2; } });
  assert.deepEqual(events.map(function (event) { return [event.captureStopReason, event.swipeCount]; }),
    [["COMMENT_HISTORY_END", 1], ["COMMENT_HISTORY_END", 1]]);
});

test("workflow does not switch rooms on a failed held-gesture inspection", function () {
  var switches = 0;
  function ok() { return true; }
  var runtime = { openDouyin: ok, openSearch: ok, openLiveTab: ok, openFirstLive: ok,
    openAnchorSummary: ok, openAnchorProfile: ok, closeAnchorProfile: ok, waitRandom: ok,
    readViewerCount: function () { return { count: 500 }; },
    readRoomIdentity: function () { return { text: "room" }; },
    readComments: function () { return { text: "preserved" }; },
    swipeComments: function () { return { success: false, reason: "COMMENT_HOLD_UNAVAILABLE" }; },
    nextLive: function () { switches += 1; return true; }
  };
  var result = require("../features/new-comment/workflow.js").createIsolatedLiveCommentWorkflow({
    runtime: runtime, continueAfterCapture: true
  }).run({ targetKeyword: "crop" }, { shouldStop: function () { return switches === 1; } });
  assert.equal(switches, 0);
  assert.equal(result.reasonCode, "COMMENT_SWIPE_FAILED");
  assert.equal(result.comments[0].commentText, "preserved");
});

test("banner rectangle scales with the phone resolution and stays inside the screen", function () {
  var layout = require("../features/new-comment/douyin-layout.js");
  var small = layout.getRegion("commentHistoryEnd", { width: 540, height: 1124 });
  assert.deepEqual([small.left, small.top, small.width, small.height], [20, 742, 173, 36]);
});

test("slow OCR may finish after release when its source frame was captured while held", function () {
  var run = heldRuntime("", function (options, advance) {
    options.ocrEngine.recognize = function () { advance(2100); return "没有更多信息了"; };
  });
  assert.equal(run.result.success, true);
  assert.equal(run.result.value.endDetected, true);
  assert.equal(run.recycled.length, 2);
});

test("a late follow-up frame is discarded after an earlier valid negative inspection", function () {
  var calls = 0;
  var run = heldRuntime("57条新消息", function (options, advance) {
    var capture = options.captureScreen;
    options.captureScreen = function () {
      var image = capture(); calls += 1;
      if (calls === 2) advance(2100);
      return image;
    };
  });
  assert.equal(run.result.success, true);
  assert.equal(run.result.value.endDetected, false);
  assert.equal(run.recycled.length, 3);
});
