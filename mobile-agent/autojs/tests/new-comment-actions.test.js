"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var contract = require("../features/new-comment/contract.js");
var layout = require("../features/new-comment/douyin-layout.js");
var createGestureActions = require("../features/new-comment/gesture-actions.js").createGestureActions;
var createScreenActions = require("../features/new-comment/screen-actions.js").createScreenActions;

var STOP_RESULT = {
  success: false,
  reason: "STOP_REQUESTED",
  message: "task stopped"
};

function createGestureDeps(overrides) {
  var deps = {
    driver: {
      click: function () { return true; },
      swipe: function () { return true; }
    },
    sleep: function () {},
    random: function (min, max) { return max; },
    screenSize: function () { return { width: 100, height: 200 }; },
    shouldStop: function () { return false; }
  };
  Object.keys(overrides || {}).forEach(function (key) {
    deps[key] = overrides[key];
  });
  return deps;
}

function createScreenDeps(overrides) {
  var clock = 0;
  var deps = {
    findNode: function () { return null; },
    now: function () { return clock; },
    sleep: function (ms) { clock += ms; },
    captureScreen: function () { return null; },
    ocr: function () { return []; },
    screenSize: function () { return { width: 100, height: 200 }; },
    shouldStop: function () { return false; }
  };
  Object.keys(overrides || {}).forEach(function (key) {
    deps[key] = overrides[key];
  });
  return deps;
}

test("contract exposes the isolated feature key and exact stop failure", function () {
  assert.equal(contract.FEATURE_KEY, "isolated_live_comment_entry");
  assert.deepEqual(contract.stopped(), STOP_RESULT);
});

test("layout regions and computed gestures stay inside different screens", function () {
  [{ width: 1080, height: 2400 }, { width: 37, height: 61 }].forEach(function (size) {
    ["comment", "liveEnded", "viewerCount"].forEach(function (name) {
      var region = layout.getRegion(name, size);
      assert.ok(region.left >= 0 && region.top >= 0);
      assert.ok(region.width > 0 && region.height > 0);
      assert.ok(region.left + region.width <= size.width);
      assert.ok(region.top + region.height <= size.height);
    });
    ["up", "down", "left", "right"].forEach(function (direction) {
      var swipe = layout.getSwipe(direction, size);
      [swipe.startX, swipe.endX].forEach(function (x) {
        assert.ok(x >= 0 && x < size.width);
      });
      [swipe.startY, swipe.endY].forEach(function (y) {
        assert.ok(y >= 0 && y < size.height);
      });
    });
  });
  assert.deepEqual(layout.REGION_RATIOS.comment, {
    left: 0.055,
    top: 0.622,
    width: 0.855,
    height: 0.247
  });
});

test("layout keeps the required comment and live-room swipe ratios", function () {
  var size = { width: 1080, height: 2400 };
  var commentRegion = layout.getRegion("comment", size);
  var commentSwipe = layout.getCommentSwipe(size);
  var liveRoomSwipe = layout.getLiveRoomSwitchSwipe(size);

  assert.equal(commentSwipe.startY, commentRegion.top + Math.round(commentRegion.height * 0.82));
  assert.equal(commentSwipe.endY, commentRegion.top + Math.round(commentRegion.height * 0.18));
  assert.equal(commentSwipe.durationMs, 520);
  assert.equal(liveRoomSwipe.startY, Math.round(size.height * 0.78));
  assert.equal(liveRoomSwipe.endY, Math.round(size.height * 0.22));
});

test("click jitter stays inside node bounds and the screen", function () {
  var calls = [];
  var deps = createGestureDeps({
    driver: {
      click: function (x, y) {
        calls.push({ x: x, y: y });
        return true;
      }
    }
  });
  var actions = createGestureActions(deps, layout);
  var nodeResult = actions.click({
    bounds: function () {
      return { left: 92, top: 190, right: 120, bottom: 230 };
    }
  }, { jitterX: 40, jitterY: 40 });
  var pointResult = actions.click({ x: 1, y: 1 }, { jitterX: 50, jitterY: 50 });

  assert.equal(nodeResult.success, true);
  assert.equal(pointResult.success, true);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].x >= 92 && calls[0].x <= 99);
  assert.ok(calls[0].y >= 190 && calls[0].y <= 199);
  assert.ok(calls[1].x >= 0 && calls[1].x <= 99);
  assert.ok(calls[1].y >= 0 && calls[1].y <= 199);
});

test("doubleClick performs click, bounded interval, then click", function () {
  var events = [];
  var deps = createGestureDeps({
    driver: {
      click: function (x, y) {
        events.push({ type: "click", x: x, y: y });
        return true;
      }
    },
    sleep: function (ms) { events.push({ type: "sleep", ms: ms }); },
    random: function (min) { return min; }
  });
  var result = createGestureActions(deps, layout).doubleClick(
    { x: 40, y: 80 },
    { jitterX: 0, jitterY: 0, intervalMinMs: 70, intervalMaxMs: 90 }
  );

  assert.equal(result.success, true);
  assert.deepEqual(events, [
    { type: "click", x: 40, y: 80 },
    { type: "sleep", ms: 70 },
    { type: "click", x: 40, y: 80 }
  ]);
});

test("all four swipe directions are correct and bounded", function () {
  var calls = [];
  var deps = createGestureDeps({
    driver: {
      swipe: function (startX, startY, endX, endY, durationMs) {
        calls.push({ startX: startX, startY: startY, endX: endX, endY: endY, durationMs: durationMs });
        return true;
      }
    }
  });
  var actions = createGestureActions(deps, layout);
  ["up", "down", "left", "right"].forEach(function (direction) {
    assert.equal(actions.swipe(direction).success, true);
  });

  assert.ok(calls[0].startY > calls[0].endY);
  assert.ok(calls[1].startY < calls[1].endY);
  assert.ok(calls[2].startX > calls[2].endX);
  assert.ok(calls[3].startX < calls[3].endX);
  calls.forEach(function (call) {
    assert.ok(call.startX >= 0 && call.startX < 100);
    assert.ok(call.endX >= 0 && call.endX < 100);
    assert.ok(call.startY >= 0 && call.startY < 200);
    assert.ok(call.endY >= 0 && call.endY < 200);
  });
});

test("stop before click, waitForNode and captureRegions calls no driver", function () {
  var calls = [];
  var stopped = function () { return true; };
  var gestureResult = createGestureActions(createGestureDeps({
    shouldStop: stopped,
    driver: { click: function () { calls.push("click"); } }
  }), layout).click({ x: 1, y: 1 });
  var screenActions = createScreenActions(createScreenDeps({
    shouldStop: stopped,
    findNode: function () { calls.push("find"); },
    captureScreen: function () { calls.push("capture"); }
  }), layout);

  assert.deepEqual(gestureResult, STOP_RESULT);
  assert.deepEqual(screenActions.waitForNode({ text: "直播" }, 100), STOP_RESULT);
  assert.deepEqual(screenActions.captureRegions(), STOP_RESULT);
  assert.deepEqual(calls, []);
});

test("waitForNode times out with finite polling", function () {
  var lookups = 0;
  var sleeps = 0;
  var actions = createScreenActions(createScreenDeps({
    findNode: function () { lookups += 1; return null; },
    sleep: function () { sleeps += 1; }
  }), layout);
  var result = actions.waitForNode({ text: "missing" }, 450);

  assert.equal(result.success, false);
  assert.equal(result.reason, "NODE_TIMEOUT");
  assert.ok(lookups > 0 && lookups <= 4);
  assert.ok(sleeps <= 3);
});

test("readText accepts node text and desc", function () {
  var nodes = [
    { text: function () { return "在线 12 人"; }, desc: function () { return "ignored"; } },
    { text: function () { return ""; }, desc: function () { return "搜索"; } }
  ];
  var actions = createScreenActions(createScreenDeps({
    findNode: function () { return nodes.shift(); }
  }), layout);

  assert.deepEqual(actions.readText({}, 0), { success: true, value: "在线 12 人" });
  assert.deepEqual(actions.readText({}, 0), { success: true, value: "搜索" });
});

test("gesture driver false and thrown errors become stable failures", function () {
  var rejected = createGestureActions(createGestureDeps({
    driver: { click: function () { return false; } }
  }), layout).click({ x: 2, y: 3 });
  var failed = createGestureActions(createGestureDeps({
    driver: { swipe: function () { throw new Error("device unavailable"); } }
  }), layout).swipe("up");

  assert.equal(rejected.success, false);
  assert.equal(rejected.reason, "DRIVER_REJECTED");
  assert.equal(failed.success, false);
  assert.equal(failed.reason, "DRIVER_ERROR");
});

test("captureRegions recycles image after success and parser error", function () {
  var recycled = 0;
  function snapshot() {
    return { image: { recycle: function () { recycled += 1; } }, width: 100, height: 200 };
  }
  var successActions = createScreenActions(createScreenDeps({
    captureScreen: snapshot,
    ocr: function () { return { text: "hello" }; },
    parseOcr: function (ocrResult) { return ocrResult.text; }
  }), layout);
  var success = successActions.captureRegions(["comment"]);
  var failureActions = createScreenActions(createScreenDeps({
    captureScreen: snapshot,
    ocr: function () { return { text: "bad" }; },
    parseOcr: function () { throw new Error("parse failed"); }
  }), layout);
  var failure = failureActions.captureRegions(["comment"]);

  assert.equal(success.success, true);
  assert.equal(success.value[0].value, "hello");
  assert.equal(failure.success, false);
  assert.equal(failure.reason, "OCR_FAILED");
  assert.equal(recycled, 2);
});

test("captureRegions checks stop after an empty capture result", function () {
  var stopChecks = 0;
  var captures = 0;
  var actions = createScreenActions(createScreenDeps({
    shouldStop: function () {
      stopChecks += 1;
      return stopChecks >= 2;
    },
    captureScreen: function () {
      captures += 1;
      return null;
    }
  }), layout);

  assert.deepEqual(actions.captureRegions(), STOP_RESULT);
  assert.equal(captures, 1);
});

test("detectPlatformVerification only reports diagnostics and never acts", function () {
  var actionsCalled = 0;
  var actions = createScreenActions(createScreenDeps({
    detectRisk: function () { return { detected: true, signal: "slider" }; },
    getPageStructure: function () { return { title: "安全验证" }; },
    getActionTrace: function () { return ["search", "enter-live"]; },
    driver: {
      click: function () { actionsCalled += 1; },
      swipe: function () { actionsCalled += 1; }
    }
  }), layout);
  var result = actions.detectPlatformVerification();

  assert.equal(result.success, false);
  assert.equal(result.reason, "PLATFORM_VERIFICATION");
  assert.equal(result.details.risk.signal, "slider");
  assert.deepEqual(result.details.pageStructure, { title: "安全验证" });
  assert.deepEqual(result.details.actionTrace, ["search", "enter-live"]);
  assert.equal(actionsCalled, 0);
});

test("verification diagnostics stop before reading the next diagnostic", function () {
  var stopped = false;
  var traceReads = 0;
  var actions = createScreenActions(createScreenDeps({
    shouldStop: function () { return stopped; },
    detectRisk: function () { return { detected: true }; },
    getPageStructure: function () {
      stopped = true;
      return { title: "安全验证" };
    },
    getActionTrace: function () {
      traceReads += 1;
      return [];
    }
  }), layout);

  assert.deepEqual(actions.detectPlatformVerification(), STOP_RESULT);
  assert.equal(traceReads, 0);
});
