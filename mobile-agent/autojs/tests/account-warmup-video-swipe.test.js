// 职责：守护视频养号的滑动手势几何、时长解析、贝塞尔派发重试与页面上下文探测。
// 硬约束：下滑只允许贝塞尔曲线，禁止直线兜底（见远程脚本模块进度台账 2026-09-10）。

var assert = require("assert");
var test = require("node:test");
var videoFoundation = require("../features/account-warmup/video-warmup-foundation.js");
var swipeGeometry = require("../features/account-warmup/video-warmup-swipe.js");

function minRandom(min) { return min; }
function maxRandom(min, max) { return max; }

function perpendicularDistance(point, start, end) {
  var deltaX = end.x - start.x;
  var deltaY = end.y - start.y;
  var length = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;
  return Math.abs((point.x - start.x) * deltaY - (point.y - start.y) * deltaX) / length;
}

function sideOf(point, start, end) {
  var value = (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x);
  return value === 0 ? 0 : value > 0 ? 1 : -1;
}

function testSwipeStartsBelowAndEndsAbove() {
  [
    { randomInt: minRandom, label: "min" },
    { randomInt: maxRandom, label: "max" }
  ].forEach(function (scenario) {
    var coordinates = swipeGeometry.videoSwipeCoordinates({ width: 1080, height: 2248 }, scenario.randomInt);
    assert(coordinates.start.y > coordinates.end.y, scenario.label + ": 起点必须在下方、终点在上方（手指由下往上滑）");
    assert(coordinates.end.y < 2248 * 0.3, scenario.label + ": 终点必须落在屏幕上部");
    assert(coordinates.start.y > 2248 * 0.6, scenario.label + ": 起点必须落在屏幕下部");
  });
}

function testSwipeCoordinatesMatchMinRandomization() {
  var requested = [];
  var coordinates = swipeGeometry.videoSwipeCoordinates({ width: 1080, height: 2248 }, function (min, max) {
    requested.push([min, max]);
    return min;
  });

  assert.deepStrictEqual(coordinates.start, { x: 498, y: 1444 });
  assert.deepStrictEqual(coordinates.end, { x: 471, y: 395 });
  assert.strictEqual(coordinates.durationMs, 480);
  assert.deepStrictEqual(requested, [
    [498, 547], [1444, 1602], [471, 549], [395, 625],
    [0, 1], [26, 40], [60, 76], [38, 63], [13, 44],
    [480, 600]
  ]);
}

function testSwipeDurationIsRandomizedWithinBounds() {
  assert.strictEqual(
    swipeGeometry.videoSwipeCoordinates({ width: 1080, height: 2248 }, minRandom).durationMs,
    swipeGeometry.SWIPE_DURATION_MIN_MS
  );
  assert.strictEqual(
    swipeGeometry.videoSwipeCoordinates({ width: 1080, height: 2248 }, maxRandom).durationMs,
    swipeGeometry.SWIPE_DURATION_MAX_MS
  );
}

function testControlPointsBowOffTheStraightLine() {
  [
    { randomInt: minRandom, label: "min" },
    { randomInt: maxRandom, label: "max" }
  ].forEach(function (scenario) {
    var coordinates = swipeGeometry.videoSwipeCoordinates({ width: 1080, height: 2248 }, scenario.randomInt);
    var first = coordinates.controlPoints[0];
    var second = coordinates.controlPoints[1];

    assert(
      perpendicularDistance(first, coordinates.start, coordinates.end) > 8,
      scenario.label + ": 第一个控制点必须偏离直线，不能是笔直直线"
    );
    assert(
      perpendicularDistance(second, coordinates.start, coordinates.end) > 8,
      scenario.label + ": 第二个控制点必须偏离直线"
    );
    assert.strictEqual(
      sideOf(first, coordinates.start, coordinates.end),
      sideOf(second, coordinates.start, coordinates.end),
      scenario.label + ": 两个控制点必须同侧，否则会变成 S 形"
    );
    assert.notStrictEqual(
      Math.round(perpendicularDistance(first, coordinates.start, coordinates.end)),
      Math.round(perpendicularDistance(second, coordinates.start, coordinates.end)),
      scenario.label + ": 两个控制点位移不同，避免退化成正圆弧"
    );
  });
}

function testSwipeScalesDownToSmallerScreens() {
  var coordinates = swipeGeometry.videoSwipeCoordinates({ width: 540, height: 1124 }, function (min) { return min; });
  assert.strictEqual(coordinates.start.x, 249);
  assert.strictEqual(coordinates.end.y, 197);
  assert(coordinates.start.y > coordinates.end.y, "缩放后方向仍需保持由下往上");
}

function testSecondsPerVideoUsesPayloadAndClamps() {
  assert.strictEqual(swipeGeometry.resolveSecondsPerVideo(10), 10);
  assert.strictEqual(swipeGeometry.resolveSecondsPerVideo("12"), 12);
  assert.strictEqual(swipeGeometry.resolveSecondsPerVideo(undefined), swipeGeometry.DEFAULT_SECONDS_PER_VIDEO);
  assert.strictEqual(swipeGeometry.resolveSecondsPerVideo(0), swipeGeometry.DEFAULT_SECONDS_PER_VIDEO);
  assert.strictEqual(swipeGeometry.resolveSecondsPerVideo("abc"), swipeGeometry.DEFAULT_SECONDS_PER_VIDEO);
  assert.strictEqual(swipeGeometry.resolveSecondsPerVideo(-5), swipeGeometry.DEFAULT_SECONDS_PER_VIDEO);
  assert.strictEqual(swipeGeometry.resolveSecondsPerVideo(1), swipeGeometry.MIN_SECONDS_PER_VIDEO);
  assert.strictEqual(swipeGeometry.resolveSecondsPerVideo(99999), swipeGeometry.MAX_SECONDS_PER_VIDEO);
}

function testWatchDurationUsesInclusiveMillisecondBounds() {
  assert.strictEqual(
    swipeGeometry.resolveWatchDurationMs(function (min) { return min; }),
    swipeGeometry.WATCH_DURATION_MIN_MS
  );
  assert.strictEqual(
    swipeGeometry.resolveWatchDurationMs(function (min, max) { return max; }),
    swipeGeometry.WATCH_DURATION_MAX_MS
  );
  var duration = swipeGeometry.resolveWatchDurationMs(function () { return 12345; });
  assert.strictEqual(duration, 12345);
  assert.strictEqual(Number.isInteger(duration), true);
}

function createUi(overrides) {
  overrides = overrides || {};
  var calls = { adapterNextVideo: 0, globalSwipe: 0, recover: 0 };
  var logs = { info: [], warn: [] };
  var originalSwipe = global.swipe;
  global.swipe = function () { calls.globalSwipe += 1; return true; };
  var ui = videoFoundation.createDefaultUi({
    screenSize: function () { return { width: 1080, height: 2248 }; },
    logger: {
      info: function (message, payload) { logs.info.push({ message: message, payload: payload }); },
      warn: function (message, payload) { logs.warn.push({ message: message, payload: payload }); }
    },
    random: overrides.random || minRandom,
    wait: function () {},
    context: {
      accessibility: overrides.accessibility === undefined
        ? { createGestureDriver: function () { return { swipe: function () { return { success: true }; } }; } }
        : overrides.accessibility,
      douyin: overrides.douyin || {
        nextVideo: function () { calls.adapterNextVideo += 1; return true; },
        recover: function () { calls.recover += 1; return true; }
      }
    }
  });
  return {
    ui: ui,
    calls: calls,
    logs: logs,
    restore: function () {
      if (originalSwipe === undefined) delete global.swipe;
      else global.swipe = originalSwipe;
    }
  };
}

function testNextVideoPrefersBezierWithoutFallingBack() {
  var harness = createUi();
  try {
    var result = harness.ui.nextVideo();
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.path, "accessibility_bezier");
    assert.strictEqual(harness.calls.adapterNextVideo, 0);
    assert.strictEqual(harness.calls.globalSwipe, 0);
    assert.strictEqual(harness.logs.info.length, 1);
    assert.match(harness.logs.info[0].message, /派发.*接受/);
    assert.strictEqual(harness.logs.info[0].payload.actionSignature, "video_bezier_bow_v2");
    assert.strictEqual(harness.logs.info[0].payload.dispatchAccepted, true);
    assert(harness.logs.info[0].payload.start.y > harness.logs.info[0].payload.end.y);
  } finally {
    harness.restore();
  }
}

function testNextVideoNeverDispatchesAStraightLine() {
  [
    { accessibility: null, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" },
    { accessibility: {}, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" },
    { accessibility: { createGestureDriver: function () { return null; } }, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" },
    { accessibility: { createGestureDriver: function () { return {}; } }, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" },
    { accessibility: { createGestureDriver: function () { throw new Error("driver failed"); } }, reason: "ACCESSIBILITY_GESTURE_FAILED" },
    { accessibility: { createGestureDriver: function () { return { swipe: function () { throw new Error("native failed"); } }; } }, reason: "ACCESSIBILITY_GESTURE_FAILED" },
    { accessibility: { createGestureDriver: function () { return { swipe: function () { return {}; } }; } }, reason: "ACCESSIBILITY_GESTURE_RESULT_INVALID" },
    { accessibility: { createGestureDriver: function () { return { swipe: function () { return { success: false, reason: "ACCESSIBILITY_GESTURE_REJECTED" }; } }; } }, reason: "ACCESSIBILITY_GESTURE_REJECTED" }
  ].forEach(function (scenario) {
    var harness = createUi({ accessibility: scenario.accessibility });
    try {
      var result = harness.ui.nextVideo();
      assert.strictEqual(result.accepted, false, scenario.reason + ": 派发不成功必须如实报失败");
      assert.strictEqual(result.path, "");
      assert.strictEqual(result.reason, scenario.reason);
      assert.strictEqual(harness.calls.adapterNextVideo, 0, scenario.reason + ": 禁止降级到平台直线滑动");
      assert.strictEqual(harness.calls.globalSwipe, 0, scenario.reason + ": 禁止降级到全局直线滑动");
      assert.strictEqual(harness.logs.warn.length, 1);
      assert.match(harness.logs.warn[0].message, /派发失败/);
      assert.strictEqual(harness.logs.warn[0].payload.start.y > harness.logs.warn[0].payload.end.y, true);
    } finally {
      harness.restore();
    }
  });
}

function testNextVideoRetriesBezierBeforeGivingUp() {
  var attempts = 0;
  var paths = [];
  var drawIndex = 0;
  var harness = createUi({
    random: function (min, max) {
      drawIndex += 1;
      return min + ((drawIndex * 7) % (max - min + 1));
    },
    accessibility: {
      createGestureDriver: function () {
        return {
          swipe: function (input) {
            attempts += 1;
            paths.push(input);
            if (attempts < 2) return { success: false, reason: "ACCESSIBILITY_GESTURE_REJECTED" };
            return { success: true };
          }
        };
      }
    }
  });

  try {
    var result = harness.ui.nextVideo();
    assert.strictEqual(attempts, 2, "第一次被拒后应重试一次贝塞尔手势");
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.path, "accessibility_bezier");
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(harness.calls.adapterNextVideo, 0);
    assert.strictEqual(harness.calls.globalSwipe, 0);
    assert.strictEqual(harness.logs.info.length, 1);
    assert.strictEqual(harness.logs.info[0].payload.attempts, 2);
    assert.strictEqual(harness.logs.info[0].payload.dispatchAccepted, true);
    assert(
      paths[0].points[0].x !== paths[1].points[0].x || paths[0].points[0].y !== paths[1].points[0].y,
      "重试应生成新的随机路径，而不是复读同一条轨迹"
    );
    assert.deepStrictEqual(
      paths.map(function (item) { return item.controlPoints.length; }),
      [2, 2],
      "每次重试都必须带两个控制点，绝不能退化成直线"
    );
    paths.forEach(function (item) {
      assert(item.points[0].y > item.points[1].y, "重试路径同样必须由下往上");
    });
  } finally {
    harness.restore();
  }
}

function testNextVideoStopsAfterTwoAttemptsAndReportsAttemptCount() {
  var attempts = 0;
  var harness = createUi({
    accessibility: {
      createGestureDriver: function () {
        return { swipe: function () { attempts += 1; return { success: false, reason: "ACCESSIBILITY_GESTURE_REJECTED" }; } };
      }
    }
  });
  try {
    var result = harness.ui.nextVideo();
    assert.strictEqual(attempts, 2);
    assert.strictEqual(result.accepted, false);
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(result.reason, "ACCESSIBILITY_GESTURE_REJECTED");
  } finally {
    harness.restore();
  }
}

function testVerifyVideoContextDetectsLoss() {
  var healthy = createUi({
    douyin: {
      isForeground: function () { return true; },
      isLiveRoomVisible: function () { return false; },
      recover: function () { return true; }
    }
  });
  try {
    assert.deepStrictEqual(healthy.ui.verifyVideoContext(), { ok: true, reason: "" });
  } finally {
    healthy.restore();
  }

  var backgrounded = createUi({ douyin: { isForeground: function () { return false; } } });
  try {
    assert.deepStrictEqual(backgrounded.ui.verifyVideoContext(), { ok: false, reason: "DOUYIN_NOT_FOREGROUND" });
  } finally {
    backgrounded.restore();
  }

  var inLiveRoom = createUi({
    douyin: {
      isForeground: function () { return true; },
      isLiveRoomVisible: function () { return true; }
    }
  });
  try {
    assert.deepStrictEqual(inLiveRoom.ui.verifyVideoContext(), { ok: false, reason: "LIVE_ROOM_ENTERED" });
  } finally {
    inLiveRoom.restore();
  }

  var probeBroken = createUi({
    douyin: {
      isForeground: function () { throw new Error("probe failed"); },
      isLiveRoomVisible: function () { return true; }
    }
  });
  try {
    assert.deepStrictEqual(probeBroken.ui.verifyVideoContext(), { ok: true, reason: "FOREGROUND_PROBE_ERROR" });
  } finally {
    probeBroken.restore();
  }

  var recoverCalls = 0;
  var recoverable = createUi({ douyin: { recover: function () { recoverCalls += 1; return true; } } });
  try {
    assert.strictEqual(recoverable.ui.recoverVideoContext(), true);
    assert.strictEqual(recoverCalls, 1);
  } finally {
    recoverable.restore();
  }

  var unrecoverable = createUi({ douyin: {} });
  try {
    assert.strictEqual(unrecoverable.ui.recoverVideoContext(), false);
  } finally {
    unrecoverable.restore();
  }
}

[
  testSwipeStartsBelowAndEndsAbove,
  testSwipeCoordinatesMatchMinRandomization,
  testSwipeDurationIsRandomizedWithinBounds,
  testControlPointsBowOffTheStraightLine,
  testSwipeScalesDownToSmallerScreens,
  testSecondsPerVideoUsesPayloadAndClamps,
  testWatchDurationUsesInclusiveMillisecondBounds,
  testNextVideoPrefersBezierWithoutFallingBack,
  testNextVideoNeverDispatchesAStraightLine,
  testNextVideoRetriesBezierBeforeGivingUp,
  testNextVideoStopsAfterTwoAttemptsAndReportsAttemptCount,
  testVerifyVideoContextDetectsLoss
].forEach(function (run) { test(run.name, run); });
