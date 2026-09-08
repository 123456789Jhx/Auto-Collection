"use strict";
var assert = require("node:assert/strict");
var test = require("node:test");
var accessibility = require("../core/accessibility.js");

function nativeHarness(mode) {
  var clock = 0, queue = [], events = [], down = false, dispatches = 0;
  function Path() { this.points = []; }
  Path.prototype.moveTo = Path.prototype.lineTo = function (x, y) { this.points.push([x, y]); };
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
  function advance(ms) {
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
      if (mode === "reject" && dispatches === 1 || mode === "rejectHold" && dispatches === 2) return false;
      if (stroke.parent) {
        assert.equal(down, true, "continuation must not introduce a new touch");
        assert.deepEqual(stroke.path.points, [[220, 1962]]);
        events.push(["hold", clock, stroke.duration]);
      } else { down = true; events.push(["down", clock]); }
      queue.push({ at: clock + stroke.duration, run: function () {
        if (mode === "cancel" && dispatches === 1 || mode === "cancelHold" && dispatches === 2) {
          down = false; callback.onCancelled(); return;
        }
        if (!stroke.continues) { down = false; events.push(["up", clock]); }
        if (callback) callback.onCompleted();
      } });
      return true;
    } }
  });
  return { driver: driver, advance: advance, events: events,
    down: function () { return down; }, now: function () { return clock; } };
}
var INPUT = { points: [{ x: 220, y: 1522 }, { x: 220, y: 1962 }], durationMs: 520, holdMs: 2000 };

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
  assert.deepEqual(h.events, [["down", 0], ["hold", 520, 2000], ["up", 2520]]);
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
    var h = nativeHarness();
    var result = h.driver.swipeAndHold(INPUT, function () { throw new Error("must not inspect"); });
    assert.equal(result.success, false);
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
