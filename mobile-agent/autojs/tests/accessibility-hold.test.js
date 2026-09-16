"use strict";
var assert = require("node:assert/strict");
var test = require("node:test");
var accessibility = require("../core/accessibility.js");

function nativeHarness(mode) {
  var clock = 0, queue = [], events = [], strokes = [], down = false, dispatches = 0, inCallback = false;
  var fault = typeof mode === "object" ? mode : {
    rejectAt: mode === "reject" ? 1 : mode === "rejectHold" ? 2 : 0,
    cancelAt: mode === "cancel" ? 1 : mode === "cancelHold" ? 2 : 0
  };
  function Path() { this.points = []; this.commands = []; }
  Path.prototype.moveTo = function (x, y) { this.points.push([x, y]); this.commands.push(["moveTo", x, y]); };
  Path.prototype.lineTo = function (x, y) { this.points.push([x, y]); this.commands.push(["lineTo", x, y]); };
  Path.prototype.quadTo = function (cx, cy, x, y) {
    this.points.push([x, y]); this.commands.push(["quadTo", cx, cy, x, y]);
  };
  Path.prototype.cubicTo = function (c1x, c1y, c2x, c2y, x, y) {
    this.points.push([x, y]); this.commands.push(["cubicTo", c1x, c1y, c2x, c2y, x, y]);
  };
  if (fault.missingCubicTo) delete Path.prototype.cubicTo;
  function Stroke(path, start, duration, continues) {
    this.path = path; this.duration = duration; this.continues = !!continues;
  }
  Stroke.prototype.continueStroke = function (path, start, duration, continues) {
    var stroke = new Stroke(path, start, duration, continues);
    stroke.parent = this;
    return stroke;
  };
  function Builder() {}
  Builder.prototype.addStroke = function (stroke) { this.stroke = stroke; return this; };
  Builder.prototype.build = function () { return this.stroke; };
  function Atomic(value) { this.value = value; }
  Atomic.prototype.get = function () { return this.value; };
  Atomic.prototype.set = function (value) { this.value = value; };
  Atomic.prototype.compareAndSet = function (expected, value) {
    if (this.value !== expected) return false;
    this.value = value; return true;
  };
  function schedule(at, run) {
    queue.push({ at: at, run: run });
    queue.sort(function (a, b) { return a.at - b.at; });
  }
  function advance(ms) {
    assert.equal(inCallback, false, "gesture callbacks must not block the Android main thread");
    var target = clock + ms;
    while (queue.length && queue[0].at <= target) {
      var pending = queue.shift(); clock = pending.at; pending.run();
    }
    clock = target;
  }
  var driver = accessibility.createGestureDriver({
    Path: Path, GestureDescription: { StrokeDescription: Stroke, Builder: Builder },
    AtomicInteger: Atomic, createGestureCallback: function (handlers) { return handlers; }, handler: {},
    now: function () { return clock; }, sleep: advance,
    service: { dispatchGesture: function (stroke, callback) {
      dispatches += 1;
      var dispatchIndex = dispatches;
      strokes.push(stroke);
      if (fault.throwAt === dispatchIndex) throw new Error("dispatch failed");
      if (fault.rejectAt === dispatchIndex) return false;
      if (stroke.parent) {
        assert.equal(down, true, "continuation must not introduce a new touch");
        assert.equal(stroke.parent.continues, true);
        assert.deepEqual(stroke.path.points[0], stroke.parent.path.points[stroke.parent.path.points.length - 1]);
        events.push([stroke.path.points.length > 1 ? "move" : "hold", clock, stroke.duration]);
      } else { down = true; events.push(["down", clock]); }
      // Android 10 can complete a stationary continuing stroke immediately after DOWN.
      var completionMs = stroke.continues && stroke.path.points.length === 1 && !fault.completeStationaryAtDuration
        ? 0 : stroke.duration;
      schedule(clock + completionMs, function () {
        if (!stroke.continues) { down = false; events.push(["up", clock]); }
        if (!callback || fault.missingCallbackAt === dispatchIndex) return;
        schedule(clock + (fault.callbackDelayAt === dispatchIndex ? fault.callbackDelayMs : 0), function () {
          inCallback = true;
          try {
            if (fault.cancelAt === dispatchIndex) { down = false; callback.onCancelled(); }
            else callback.onCompleted();
          } finally { inCallback = false; }
        });
      });
      return true;
    } }
  });
  return { driver: driver, advance: advance, events: events, strokes: strokes,
    down: function () { return down; }, now: function () { return clock; } };
}
var INPUT = { points: [{ x: 220, y: 1522 }, { x: 220, y: 1962 }], durationMs: 520, holdMs: 2000 };

test("accelerating bezier keeps the finger down across slow and fast phases", function () {
  var h = nativeHarness();
  var result = h.driver.swipeAccelerated({
    points: [{ x: 960, y: 2050 }, { x: 980, y: 820 }],
    controlPoints: [{ x: 900, y: 1700 }, { x: 1040, y: 1100 }],
    durationMs: 500
  });

  assert.equal(result.success, true);
  assert.equal(result.timingProfile, "accelerate_ease_in");
  assert.equal(result.accelerationMultiplier, 3.5);
  assert.deepEqual(result.phaseDurations, [359, 141]);
  assert.equal(h.strokes.length, 1);
  assert.equal(h.strokes[0].continues, true);
  h.advance(359);
  assert.equal(h.strokes.length, 2);
  assert.equal(h.strokes[1].continues, false);
  assert.equal(h.strokes[1].parent, h.strokes[0]);
  h.advance(141);
  assert.equal(h.down(), false);
});

test("continuous swipe arrives before inspection and releases after two seconds at the endpoint", function () {
  var h = nativeHarness(), inspected = false;
  var result = h.driver.swipeAndHold(INPUT, function (isHeld) {
    inspected = true;
    assert.ok(h.now() >= 520 && h.now() < 2520);
    assert.equal(h.down(), true);
    assert.equal(isHeld(), true);
    return { success: true, value: { endDetected: true } };
  });
  assert.equal(result.success, true);
  assert.equal(inspected, true);
  assert.equal(h.down(), false);
  assert.deepEqual(h.strokes[0].path.commands, [["moveTo", 220, 1522], ["lineTo", 220, 1962]]);
  assert.deepEqual(h.events, [["down", 0], ["hold", 520, 2000], ["up", 2520]]);
});

test("quadratic movement keeps the same touch down at its actual endpoint for inspection", function () {
  var h = nativeHarness();
  var result = h.driver.swipeAndHold({
    points: [{ x: 279, y: 1607 }, { x: 338, y: 1880 }],
    controlPoint: { x: 360, y: 1744 }, durationMs: 520, holdMs: 2000
  }, function (isHeld) {
    assert.equal(isHeld(), true);
    return { success: true };
  });
  assert.equal(result.success, true);
  assert.deepEqual(h.strokes[0].path.commands, [["moveTo", 279, 1607], ["quadTo", 360, 1744, 338, 1880]]);
  assert.deepEqual(h.strokes[1].path.commands, [["moveTo", 338, 1880]]);
  assert.equal(h.strokes[1].parent, h.strokes[0]);
  assert.deepEqual(h.events, [["down", 0], ["hold", 520, 2000], ["up", 2520]]);
});

test("swipe supports a double Bezier path and preserves its endpoint", function () {
  var h = nativeHarness();
  var result = h.driver.swipe({
    points: [{ x: 471, y: 395 }, { x: 498, y: 1444 }],
    controlPoints: [{ x: 477, y: 745 }, { x: 492, y: 1101 }],
    durationMs: 520
  });
  assert.equal(result.success, true);
  assert.deepEqual(h.strokes[0].path.commands, [
    ["moveTo", 471, 395], ["cubicTo", 477, 745, 492, 1101, 498, 1444]
  ]);
});

test("a cubic swipe without native curve support fails before dispatching any touch", function () {
  var h = nativeHarness({ missingCubicTo: true });
  var result = h.driver.swipe({
    points: [{ x: 471, y: 395 }, { x: 498, y: 1444 }],
    controlPoints: [{ x: 479, y: 731 }, { x: 490, y: 1108 }],
    durationMs: 520
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, "ACCESSIBILITY_GESTURE_BEZIER_UNAVAILABLE");
  assert.deepEqual(h.strokes, []);
});

test("cubic controls with a non-cubic endpoint count never degrade to a straight path", function () {
  [[{ x: 471, y: 395 }], [{ x: 471, y: 395 }, { x: 498, y: 1444 }, { x: 500, y: 1500 }]].forEach(function (points) {
    var h = nativeHarness();
    var result = h.driver.swipe({
      points: points,
      controlPoints: [{ x: 479, y: 731 }, { x: 490, y: 1108 }],
      durationMs: 520
    });
    assert.equal(result.success, false);
    assert.equal(result.reason, "ACCESSIBILITY_GESTURE_CONTROL_POINTS_INVALID");
    assert.deepEqual(h.strokes, []);
  });
});

var START_HELD_INPUT = {
  points: [{ x: 279, y: 1607 }, { x: 338, y: 1880 }],
  controlPoint: { x: 360, y: 1744 }, startHoldMs: 120, durationMs: 520, holdMs: 2000
};

test("initial stationary press continues into the curve without a second touch", function () {
  var h = nativeHarness();
  var result = h.driver.swipeAndHold(START_HELD_INPUT, function (isHeld) {
    assert.equal(h.now(), 640);
    assert.equal(isHeld(), true);
    return { success: true };
  });
  assert.equal(result.success, true);
  assert.deepEqual(h.strokes[0].path.commands, [["moveTo", 279, 1607]]);
  assert.deepEqual(h.strokes[1].path.commands, [["moveTo", 279, 1607], ["quadTo", 360, 1744, 338, 1880]]);
  assert.equal(h.strokes[1].parent, h.strokes[0]);
  assert.equal(h.strokes[2].parent, h.strokes[1]);
  assert.deepEqual(h.events, [["down", 0], ["move", 120, 520], ["hold", 640, 2000], ["up", 2640]]);
  assert.equal(h.down(), false);
});

test("an early stationary callback cannot skip the requested press wait", function () {
  var h = nativeHarness();
  var result = h.driver.swipeAndHold(START_HELD_INPUT, function () { return { success: true }; });
  assert.equal(result.success, true);
  assert.deepEqual(h.events, [["down", 0], ["move", 120, 520], ["hold", 640, 2000], ["up", 2640]]);
});

test("a ROM that completes stationary strokes at their duration does not double the press wait", function () {
  var h = nativeHarness({ completeStationaryAtDuration: true });
  var result = h.driver.swipeAndHold(START_HELD_INPUT, function () { return { success: true }; });
  assert.equal(result.success, true);
  var move = h.events.find(function (event) { return event[0] === "move"; });
  assert.ok(move[1] >= 120 && move[1] <= 140, "press wait must remain close to 120ms");
});

test("press timing is measured after the callback, including delayed native delivery", function () {
  var h = nativeHarness({ callbackDelayAt: 1, callbackDelayMs: 80 });
  var result = h.driver.swipeAndHold(START_HELD_INPUT, function () { return { success: true }; });
  assert.equal(result.success, true);
  assert.deepEqual(h.events[1], ["move", 200, 520]);
});

test("STOP before the press callback or during its wait releases without moving", function () {
  [{ stopAt: 60, callbackDelayMs: 80 }, { stopAt: 60 }, { stopAt: 120 }].forEach(function (scenario) {
    var h = nativeHarness({ callbackDelayAt: 1, callbackDelayMs: scenario.callbackDelayMs || 0 });
    var inspections = 0;
    var result = h.driver.swipeAndHold(Object.assign({}, START_HELD_INPUT, {
      shouldStop: function () { return h.now() >= scenario.stopAt; }
    }), function () { inspections += 1; return { success: true }; });
    assert.equal(result.reason, "STOP_REQUESTED");
    assert.equal(inspections, 0);
    assert.equal(h.events.some(function (event) { return event[0] === "move"; }), false);
    assert.equal(h.down(), false);
    assert.ok(h.now() <= scenario.stopAt + 40, "STOP must release promptly during the press");
    h.advance(3000);
    assert.equal(h.strokes.length, 2, "a late callback must not revive a stopped gesture");
  });
});

test("a callback arriving after timeout cannot restart the released touch", function () {
  var h = nativeHarness({ callbackDelayAt: 1, callbackDelayMs: 3000 });
  var result = h.driver.swipeAndHold(START_HELD_INPUT, function () { throw new Error("must not inspect"); });
  assert.equal(result.success, false);
  h.advance(4000);
  assert.equal(h.down(), false);
  assert.equal(h.strokes.length, 2);
  assert.deepEqual(h.strokes[1].path.points, [[279, 1607]]);
});

test("gesture diagnostics report callback and dispatch times separately", function () {
  var h = nativeHarness();
  var result = h.driver.swipeAndHold(START_HELD_INPUT, function () { return { success: true }; });
  assert.equal(result.success, true);
  assert.deepEqual(result.gestureTiming, {
    pressDispatchMs: 0, pressCallbackMs: 0, moveDispatchMs: 120,
    pressCallbackToMoveDispatchMs: 120, moveCallbackMs: 640,
    holdDispatchMs: 640, holdCallbackMs: 2640
  });
});

test("STOP during the initial press releases at the start without moving or inspecting", function () {
  var h = nativeHarness(), inspections = 0;
  var input = Object.assign({}, START_HELD_INPUT, { shouldStop: function () { return h.now() >= 60; } });
  var result = h.driver.swipeAndHold(input, function () { inspections += 1; return { success: true }; });
  assert.equal(result.reason, "STOP_REQUESTED");
  assert.equal(inspections, 0);
  assert.equal(h.strokes.length, 2);
  assert.deepEqual(h.strokes[1].path.points, [[279, 1607]]);
  assert.equal(h.strokes[1].parent, h.strokes[0]);
  assert.equal(h.down(), false);
});

test("a rejected or throwing curve continuation releases the initial press", function () {
  [{ rejectAt: 2 }, { throwAt: 2 }].forEach(function (fault) {
    var h = nativeHarness(fault), inspections = 0;
    var result = h.driver.swipeAndHold(START_HELD_INPUT, function () { inspections += 1; return { success: true }; });
    assert.equal(result.success, false);
    assert.equal(inspections, 0);
    assert.equal(h.strokes.length, 3);
    assert.deepEqual(h.strokes[2].path.points, [[279, 1607]]);
    assert.equal(h.strokes[2].parent, h.strokes[0]);
    assert.equal(h.down(), false);
  });
});

test("end hold rejection after an initial press releases from the curve endpoint", function () {
  var h = nativeHarness({ rejectAt: 3 }), inspections = 0;
  var result = h.driver.swipeAndHold(START_HELD_INPUT, function () { inspections += 1; return { success: true }; });
  assert.equal(result.reason, "ACCESSIBILITY_HOLD_REJECTED");
  assert.equal(inspections, 0);
  assert.deepEqual(h.strokes[3].path.points, [[338, 1880]]);
  assert.equal(h.strokes[3].parent, h.strokes[1]);
  assert.equal(h.down(), false);
});

test("rejected or cancelled initial presses and cancelled curves never inspect", function () {
  [{ rejectAt: 1 }, { cancelAt: 1 }, { cancelAt: 2 }].forEach(function (fault) {
    var h = nativeHarness(fault), inspections = 0;
    var result = h.driver.swipeAndHold(START_HELD_INPUT, function () { inspections += 1; return { success: true }; });
    assert.equal(result.success, false);
    assert.equal(inspections, 0);
    assert.equal(h.down(), false);
  });
});

test("a missing initial completion callback releases at the start on timeout", function () {
  var h = nativeHarness({ missingCallbackAt: 1 }), inspections = 0;
  var result = h.driver.swipeAndHold(START_HELD_INPUT, function () { inspections += 1; return { success: true }; });
  h.advance(10);
  assert.equal(result.success, false);
  assert.equal(inspections, 0);
  assert.equal(h.strokes.length, 2);
  assert.deepEqual(h.strokes[1].path.points, [[279, 1607]]);
  assert.equal(h.down(), false);
});

test("slow OCR after an initial press cannot extend the native endpoint hold", function () {
  var h = nativeHarness();
  var result = h.driver.swipeAndHold(START_HELD_INPUT, function (isHeld) {
    h.advance(3000);
    assert.equal(isHeld(), false);
    assert.equal(h.down(), false);
    throw new Error("OCR failed");
  });
  assert.equal(result.success, false);
  assert.deepEqual(h.events[h.events.length - 1], ["up", 2640]);
});

test("invalid quadratic control points dispatch no touch", function () {
  [null, {}, { x: NaN, y: 1744 }, { x: 300, y: Infinity }, { x: null, y: 1744 }].forEach(function (controlPoint) {
    var h = nativeHarness();
    var input = Object.assign({}, INPUT, { controlPoint: controlPoint });
    var result = h.driver.swipeAndHold(input, function () { return { success: true }; });
    assert.equal(result.reason, "ACCESSIBILITY_GESTURE_POINTS_INVALID");
    assert.deepEqual(h.strokes, []);
  });
});

test("a quadratic path requires exactly two endpoints before dispatch", function () {
  [[], [INPUT.points[0]], INPUT.points.concat([{ x: 220, y: 2000 }])].forEach(function (points) {
    var h = nativeHarness();
    var result = h.driver.swipeAndHold({ points: points, controlPoint: { x: 300, y: 1744 } }, function () {
      return { success: true };
    });
    assert.equal(result.reason, "ACCESSIBILITY_GESTURE_POINTS_INVALID");
    assert.deepEqual(h.strokes, []);
  });
});

test("quadratic hold rejection releases from the curve endpoint", function () {
  var h = nativeHarness("rejectHold");
  var result = h.driver.swipeAndHold({
    points: [{ x: 279, y: 1607 }, { x: 245, y: 1880 }],
    controlPoint: { x: 300, y: 1744 }, durationMs: 520, holdMs: 2000
  }, function () { return { success: true }; });
  h.advance(10);
  assert.equal(result.reason, "ACCESSIBILITY_HOLD_REJECTED");
  assert.deepEqual(h.strokes[2].path.commands, [["moveTo", 245, 1880]]);
  assert.equal(h.strokes[2].parent, h.strokes[0]);
  assert.equal(h.down(), false);
});

test("native release is scheduled before OCR and still happens when OCR is slow or throws", function () {
  [false, true].forEach(function (throws) {
    var h = nativeHarness();
    var result = h.driver.swipeAndHold(INPUT, function (isHeld) {
      h.advance(3000);
      assert.equal(isHeld(), false);
      assert.equal(h.down(), false);
      if (throws) throw new Error("OCR failed");
      return { success: true, value: { endDetected: true } };
    });
    assert.equal(result.success, !throws);
    assert.deepEqual(h.events[2], ["up", 2520]);
  });
});

test("a rejected or cancelled movement never invokes OCR", function () {
  ["reject", "cancel"].forEach(function (mode) {
    var h = nativeHarness(mode), inspections = 0;
    var result = h.driver.swipeAndHold(INPUT, function () { inspections += 1; return { success: true }; });
    assert.equal(result.success, false);
    assert.equal(inspections, 0);
    assert.equal(h.down(), false);
  });
});

test("rejected hold is followed by an explicit short release continuation", function () {
  var h = nativeHarness("rejectHold");
  var result = h.driver.swipeAndHold(INPUT, function () { throw new Error("must not inspect"); });
  h.advance(10);
  assert.equal(result.success, false);
  assert.equal(h.down(), false);
});

test("STOP while moving skips inspection but still releases the native touch", function () {
  var h = nativeHarness();
  var input = Object.assign({}, INPUT, { shouldStop: function () { return h.now() >= 200; } });
  var result = h.driver.swipeAndHold(input, function () { throw new Error("must not inspect"); });
  assert.equal(result.reason, "STOP_REQUESTED");
  assert.equal(h.down(), false);
});

test("an immediate inspection exception still waits for the scheduled release", function () {
  var h = nativeHarness();
  var result = h.driver.swipeAndHold(INPUT, function () { throw new Error("capture failed"); });
  assert.equal(result.success, false);
  assert.equal(h.down(), false);
  assert.deepEqual(h.events[2], ["up", 2520]);
});

test("cancelled hold cannot report a successful marker even after positive OCR", function () {
  var h = nativeHarness("cancelHold");
  var result = h.driver.swipeAndHold(INPUT, function () { return { success: true, value: { endDetected: true } }; });
  assert.equal(result.reason, "ACCESSIBILITY_GESTURE_CANCELLED");
  assert.equal(h.down(), false);
});

test("a preexisting stop request dispatches no touch", function () {
  var h = nativeHarness();
  var input = Object.assign({}, INPUT, { shouldStop: function () { return true; } });
  assert.equal(h.driver.swipeAndHold(input, function () {}).reason, "STOP_REQUESTED");
  assert.deepEqual(h.events, []);
});
