// 职责：守护视频养号任务的编排结果——动作链顺序、失败状态、滑动熔断与页面上下文丢失分支。
// 手势几何与派发重试见 account-warmup-video-swipe.test.js。

var assert = require("assert");
var test = require("node:test");
var videoFoundation = require("../features/account-warmup/video-warmup-foundation.js");
var swipeGeometry = require("../features/account-warmup/video-warmup-swipe.js");
var createTask = videoFoundation.createVideoWarmupFoundationTask;

function createEntryUi(overrides) {
  overrides = overrides || {};
  var openedKeywords = [];
  var ui = {
    openSearchEntry: function () { return true; },
    setSearchKeyword: function (keyword) { openedKeywords.push(keyword); return true; },
    submitSearch: function () { return true; },
    openUpperVideoTab: function () { return true; },
    openLowerVideoTab: function () { return true; },
    openFirstVideo: function () { return true; },
    nextVideo: overrides.nextVideo || function () { return true; }
  };
  for (var key in overrides) {
    if (Object.prototype.hasOwnProperty.call(overrides, key) && key !== "nextVideo") ui[key] = overrides[key];
  }
  return { ui: ui, searchedKeywords: openedKeywords };
}

function createHarness(overrides) {
  overrides = overrides || {};
  var entry = createEntryUi(overrides.ui);
  var logs = { info: [], warn: [] };
  var waits = [];
  var opened = 0;
  var task = createTask({
    context: {
      douyin: {
        openApp: function () {
          opened += 1;
          return overrides.openApp === undefined ? true : overrides.openApp;
        }
      }
    },
    logger: {
      info: function (message, payload) { logs.info.push({ message: message, payload: payload }); },
      warn: function (message, payload) { logs.warn.push({ message: message, payload: payload }); }
    },
    random: overrides.random,
    wait: overrides.wait || function (delayMs) { waits.push(delayMs); },
    ui: entry.ui
  });
  return { task: task, ui: entry.ui, logs: logs, waits: waits, searchedKeywords: entry.searchedKeywords, opened: function () { return opened; } };
}

function testUsesTheTaskKeywordAndPayloadSeconds() {
  var harness = createHarness({ ui: { nextVideo: function () { harnessControl.stopped = true; return true; } } });
  var harnessControl = { stopped: false };

  assert.deepStrictEqual(harness.task.run({ targetKeyword: "  人参种植  ", secondsPerVideo: 10 }, {
    shouldStop: function () { return harnessControl.stopped; }
  }), { status: "STOPPED", watchedVideos: 1 });
  assert.strictEqual(harness.opened(), 1);
  assert.deepStrictEqual(harness.searchedKeywords, ["人参种植"]);
  assert.strictEqual(harness.logs.info[0].payload.secondsPerVideo, 10);
  assert.strictEqual(harness.logs.info[0].payload.payloadSecondsPerVideo, 10);
}

function testFallsBackToDefaultSecondsWhenPayloadOmitsIt() {
  var swipes = 0;
  var harness = createHarness({ ui: { nextVideo: function () { swipes += 1; return true; } } });

  assert.deepStrictEqual(
    harness.task.run({ targetKeyword: "药材种植" }, { shouldStop: function () { return swipes >= 1; } }),
    { status: "STOPPED", watchedVideos: 1 }
  );
  assert.strictEqual(harness.logs.info[0].payload.secondsPerVideo, swipeGeometry.DEFAULT_SECONDS_PER_VIDEO);
  assert.strictEqual(harness.logs.info[0].payload.payloadSecondsPerVideo, null);
}

function testWaitsForRandomMillisecondDurationBeforeEachSwipe() {
  var randomValues = [10000, 15000];
  var randomIndex = 0;
  var swipes = 0;
  var probes = 0;
  var harness = createHarness({
    random: function (min, max) {
      assert.strictEqual(min, swipeGeometry.WATCH_DURATION_MIN_MS);
      assert.strictEqual(max, swipeGeometry.WATCH_DURATION_MAX_MS);
      return randomValues[randomIndex++];
    },
    ui: {
      nextVideo: function () {
        swipes += 1;
        return { accepted: true, path: "accessibility_bezier" };
      },
      verifyVideoContext: function () {
        probes += 1;
        return { ok: true, reason: "" };
      }
    }
  });

  var result = harness.task.run({ targetKeyword: "药材种植" }, {
    shouldStop: function () { return probes >= 2; }
  });

  assert.deepStrictEqual(result, { status: "STOPPED", watchedVideos: 2 });
  assert.strictEqual(randomIndex, 2);
  var waitsAfterEntry = harness.waits.slice(60);
  assert.strictEqual(waitsAfterEntry.reduce(function (sum, value) { return sum + value; }, 0), 3100);
  var durationLogs = harness.logs.info.filter(function (item) {
    return item.payload && item.payload.watchDurationMs !== undefined;
  });
  assert.strictEqual(durationLogs[0].payload.watchDurationMs, 10000);
  assert.strictEqual(durationLogs[1].payload.watchDurationMs, 15000);
}

function testRejectsAnEmptyTaskKeywordBeforeOpeningDouyin() {
  var harness = createHarness();

  assert.deepStrictEqual(harness.task.run({ targetKeyword: "   " }), {
    status: "VIDEO_WARMUP_KEYWORD_REQUIRED"
  });
  assert.strictEqual(harness.opened(), 0);
}

function testReportsWhenDouyinCannotBeOpened() {
  var harness = createHarness({ openApp: false });

  assert.deepStrictEqual(harness.task.run({ targetKeyword: "药材种植" }), { status: "DOUYIN_OPEN_FAILED" });
}

function testReportsWhichEntryActionFailed() {
  [
    { broken: "openSearchEntry", status: "VIDEO_WARMUP_SEARCH_ENTRY_FAILED" },
    { broken: "setSearchKeyword", status: "VIDEO_WARMUP_SEARCH_INPUT_FAILED" },
    { broken: "submitSearch", status: "VIDEO_WARMUP_SEARCH_SUBMIT_FAILED" },
    { broken: "openUpperVideoTab", status: "VIDEO_WARMUP_UPPER_VIDEO_TAB_FAILED" },
    { broken: "openLowerVideoTab", status: "VIDEO_WARMUP_LOWER_VIDEO_TAB_FAILED" },
    { broken: "openFirstVideo", status: "VIDEO_WARMUP_FIRST_VIDEO_FAILED" }
  ].forEach(function (scenario) {
    var uiOverride = {};
    uiOverride[scenario.broken] = function () { return false; };
    var harness = createHarness({ ui: uiOverride });

    assert.deepStrictEqual(
      harness.task.run({ targetKeyword: "药材种植" }, { shouldStop: function () { return false; } }),
      { status: scenario.status },
      scenario.broken + " 失败时必须返回对应状态而不是继续下滑"
    );
  });
}

function testGivesUpAfterThreeConsecutiveSwipeFailures() {
  var harness = createHarness({
    ui: { nextVideo: function () { return { accepted: false, path: "", reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" }; } }
  });

  assert.deepStrictEqual(harness.task.run({ targetKeyword: "药材种植" }, { shouldStop: function () { return false; } }), {
    status: "VIDEO_WARMUP_SWIPE_FAILED",
    watchedVideos: 0,
    consecutiveSwipeFailures: 3
  });
  assert.strictEqual(
    harness.logs.warn.filter(function (item) { return /手势未派发/.test(item.message); }).length,
    3
  );
}

function testResetsFailureCounterAfterASuccessfulSwipe() {
  var sequence = [false, true, false, false, false];
  var index = 0;
  var harness = createHarness({
    ui: {
      nextVideo: function () {
        var accepted = sequence[Math.min(index, sequence.length - 1)];
        index += 1;
        return accepted ? { accepted: true, path: "accessibility_bezier" } : { accepted: false, reason: "X" };
      }
    }
  });

  assert.deepStrictEqual(harness.task.run({ targetKeyword: "药材种植" }, { shouldStop: function () { return false; } }), {
    status: "VIDEO_WARMUP_SWIPE_FAILED",
    watchedVideos: 1,
    consecutiveSwipeFailures: 3
  });
  assert.strictEqual(index, 5, "成功一次后计数必须清零，因此共需 5 次滑动才熔断");
}

function testKeepsWatchingWhenContextStaysHealthy() {
  var probes = 0;
  var swipes = 0;
  var harness = createHarness({
    ui: {
      nextVideo: function () { swipes += 1; return { accepted: true, path: "accessibility_bezier" }; },
      verifyVideoContext: function () { probes += 1; return { ok: true, reason: "" }; }
    }
  });

  assert.deepStrictEqual(
    harness.task.run({ targetKeyword: "药材种植", secondsPerVideo: 3 }, { shouldStop: function () { return probes >= 2; } }),
    { status: "STOPPED", watchedVideos: 2 }
  );
  assert.strictEqual(probes, 2);
  assert.strictEqual(
    harness.logs.info.filter(function (item) { return /已滑到下一个视频/.test(item.message); }).length,
    2
  );
}

function testRecoversOnceThenEndsWhenContextNeverReturns() {
  var recoverCalls = 0;
  var probes = 0;
  var harness = createHarness({
    ui: {
      nextVideo: function () { return { accepted: true, path: "accessibility_bezier" }; },
      verifyVideoContext: function () { probes += 1; return { ok: false, reason: "LIVE_ROOM_ENTERED" }; },
      recoverVideoContext: function () { recoverCalls += 1; return true; }
    }
  });

  assert.deepStrictEqual(harness.task.run({ targetKeyword: "药材种植" }, { shouldStop: function () { return false; } }), {
    status: "VIDEO_WARMUP_CONTEXT_LOST",
    watchedVideos: 1,
    reason: "LIVE_ROOM_ENTERED"
  });
  assert.strictEqual(recoverCalls, 1, "只恢复一次，不进入无限恢复循环");
  assert.strictEqual(probes, 3, "校验 -> 复核 -> 恢复后再校验");
  assert.strictEqual(
    harness.logs.warn.filter(function (item) { return /上下文丢失/.test(item.message); }).length,
    1
  );
}

function testSkipsRecoveryWhenARecheckStillPasses() {
  var probes = 0;
  var recoverCalls = 0;
  var swipes = 0;
  var harness = createHarness({
    ui: {
      nextVideo: function () { swipes += 1; return { accepted: true, path: "accessibility_bezier" }; },
      verifyVideoContext: function () {
        probes += 1;
        return probes === 1 ? { ok: false, reason: "LIVE_ROOM_ENTERED" } : { ok: true, reason: "" };
      },
      recoverVideoContext: function () { recoverCalls += 1; return true; }
    }
  });

  assert.deepStrictEqual(
    harness.task.run({ targetKeyword: "药材种植" }, { shouldStop: function () { return probes >= 2; } }),
    { status: "STOPPED", watchedVideos: 1 }
  );
  assert.strictEqual(recoverCalls, 0, "瞬时误判不应触发页面恢复");
  assert.strictEqual(probes, 2);
}

function testEndsClearlyWhenRecoveryIsUnavailable() {
  var harness = createHarness({
    ui: {
      nextVideo: function () { return { accepted: true, path: "accessibility_bezier" }; },
      verifyVideoContext: function () { return { ok: false, reason: "DOUYIN_NOT_FOREGROUND" }; }
    }
  });

  assert.deepStrictEqual(harness.task.run({ targetKeyword: "药材种植" }, { shouldStop: function () { return false; } }), {
    status: "VIDEO_WARMUP_CONTEXT_LOST",
    watchedVideos: 1,
    reason: "CONTEXT_RECOVER_UNAVAILABLE"
  });
}

[
  testUsesTheTaskKeywordAndPayloadSeconds,
  testFallsBackToDefaultSecondsWhenPayloadOmitsIt,
  testWaitsForRandomMillisecondDurationBeforeEachSwipe,
  testRejectsAnEmptyTaskKeywordBeforeOpeningDouyin,
  testReportsWhenDouyinCannotBeOpened,
  testReportsWhichEntryActionFailed,
  testGivesUpAfterThreeConsecutiveSwipeFailures,
  testResetsFailureCounterAfterASuccessfulSwipe,
  testKeepsWatchingWhenContextStaysHealthy,
  testRecoversOnceThenEndsWhenContextNeverReturns,
  testSkipsRecoveryWhenARecheckStillPasses,
  testEndsClearlyWhenRecoveryIsUnavailable
].forEach(function (run) { test(run.name, run); });
