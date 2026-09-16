"use strict";
var assert = require("node:assert/strict");
var test = require("node:test");
var timingModule = require("../features/new-comment/action-timing.js");
var createRuntime = require("../features/new-comment/runtime.js").createIsolatedRuntime;

test("action timing exposes defaults and samples a millisecond wait", function () {
  var waits = [];
  var logs = [];
  var timing = timingModule.createActionTiming({
    random: function () { return 0.5; },
    sleep: function (milliseconds) { waits.push(milliseconds); },
    logger: { info: function (message, details) { logs.push({ message: message, details: details }); } }
  });
  assert.equal(timingModule.ACTION_KEYS.length, 17);
  timingModule.ACTION_KEYS.forEach(function (key) {
    assert.equal(Array.isArray(timing.snapshot().actions[key].beforeMs), true);
    assert.equal(Array.isArray(timing.snapshot().actions[key].afterMs), true);
  });
  assert.deepEqual(timing.range("openDouyin"), [5000, 7000]);
  assert.deepEqual(timing.range("commentOcrRetry"), [350, 650]);
  assert.deepEqual(timing.range("finishRoomCapture"), [800, 1200]);
  var result = timing.wait("commentOcrRetry", { shouldStop: function () { return false; } });
  assert.equal(result.success, true);
  assert.equal(waits.reduce(function (total, value) { return total + value; }, 0), 500);
  assert.ok(waits.every(function (value) { return value <= 100; }));
  assert.equal(logs[0].details.sampledMs, 500);
});

test("run freezes one profile per action and refreshes before the next action", function () {
  var profile = { schemaVersion: 1, actions: { readComments: { beforeMs: [10, 10], afterMs: [20, 20] } } };
  var slept = [];
  var timing = timingModule.createActionTiming({
    getProfile: function () { return profile; }, random: function (min) { return min; },
    sleep: function (milliseconds) { slept.push(milliseconds); }
  });
  var first = timing.run("readComments", function () {
    profile = { schemaVersion: 1, actions: { readComments: { beforeMs: [30, 30], afterMs: [40, 40] } } };
    return { success: true, value: "page" };
  });
  assert.equal(first.value, "page");
  timing.run("readComments", function () { return { success: true }; });
  assert.deepEqual(slept, [10, 20, 30, 40]);
});

test("run skips after timing when the action fails", function () {
  var slept = [];
  var timing = timingModule.createActionTiming({
    profile: { schemaVersion: 1, actions: { nextLive: { beforeMs: [10, 10], afterMs: [20, 20] } } },
    random: function (min) { return min; }, sleep: function (milliseconds) { slept.push(milliseconds); }
  });
  assert.equal(timing.run("nextLive", function () { return { success: false, reason: "NOPE" }; }).reason, "NOPE");
  assert.deepEqual(slept, [10]);
});

test("run preserves a completed action when stop arrives during after timing", function () {
  var stopped = false;
  var timing = timingModule.createActionTiming({
    profile: { schemaVersion: 1, actions: { readComments: { beforeMs: [0, 0], afterMs: [100, 100] } } },
    sleep: function () { stopped = true; }, random: function (min) { return min; }
  });
  var result = timing.run("readComments", function () {
    return { success: true, value: { text: "completed" } };
  }, { shouldStop: function () { return stopped; } });
  assert.equal(result.success, true);
  assert.equal(result.value.text, "completed");
});

test("deadline prevents a new action and clips after timing without losing its result", function () {
  var calls = 0;
  var timing = timingModule.createActionTiming({ sleep: function () {}, random: function (min) { return min; } });
  var blocked = timing.run("readComments", function () { calls += 1; return { success: true }; }, null,
    { remainingMs: function () { return 0; } });
  assert.equal(blocked.reason, "TIMING_DEADLINE_REACHED");
  assert.equal(calls, 0);
  var remaining = 5;
  timing = timingModule.createActionTiming({
    profile: { schemaVersion: 1, actions: { readComments: { beforeMs: [0, 0], afterMs: [20, 20] } } },
    random: function (min) { return min; }, sleep: function (milliseconds) { remaining -= milliseconds; }
  });
  var completed = timing.run("readComments", function () { calls += 1; return { success: true, value: "kept" }; }, null,
    { remainingMs: function () { return remaining; } });
  assert.equal(completed.value, "kept");
  assert.equal(remaining, 0);
});

test("valid overrides are normalized while malformed ranges and disabled profiles fall back", function () {
  var timing = timingModule.createActionTiming({
    profile: { schemaVersion: 1, enabled: true, actions: {
      openDouyin: { afterMs: [120, 240] },
      nextLive: { beforeMs: [5, 1] },
      unknown: { afterMs: [1, 2] },
      swipeComments: { afterMs: [0, 120001] },
      readComments: { beforeMs: ["1", 2], afterMs: [1.5, 2] }
    } }
  });
  assert.deepEqual(timing.range("openDouyin"), [120, 240]);
  assert.deepEqual(timing.range("nextLive", "before"), [0, 0]);
  assert.deepEqual(timing.range("swipeComments"), [2500, 4500]);
  assert.deepEqual(timing.range("readComments", "before"), [0, 0]);
  var disabled = timingModule.createActionTiming({ profile: { enabled: false, actions: { openDouyin: { afterMs: [1, 2] } } } });
  assert.deepEqual(disabled.range("openDouyin"), [5000, 7000]);
  assert.equal(disabled.snapshot().enabled, false);
  assert.equal(disabled.snapshot().sources.openDouyin, "disabled_default");
  var invalidLegacy = timingModule.createActionTiming({ openDouyinFallback: function () { return [0, 120001]; } });
  assert.deepEqual(invalidLegacy.range("openDouyin"), [5000, 7000]);
});

test("runtime wraps isolated navigation actions with the timing provider", function () {
  var events = [];
  var actions = {};
  ["openDouyin", "openSearchEntry", "setSearchKeyword", "submitSearch", "openLiveTab", "openFirstLive", "nextLive"]
    .forEach(function (key) { actions[key] = { beforeMs: [0, 0], afterMs: [0, 0] }; });
  var navigation = {};
  ["openDouyin", "openSearchEntry", "submitSearch", "openLiveTab", "openFirstLive", "nextLive"].forEach(function (key) {
    navigation[key] = function () { events.push(key); return { success: true }; };
  });
  navigation.setSearchKeyword = function (keyword) { events.push("keyword:" + keyword); return { success: true }; };
  var runtime = createRuntime({ deviceProfile: { values: { commentActionTiming: {
    schemaVersion: 1, enabled: true, actions: actions
  } } } }, { navigation: navigation, sleep: function () {}, control: { shouldStop: function () { return false; } } });
  assert.equal(runtime.openDouyin().success, true);
  assert.equal(runtime.openSearch("crop").success, true);
  assert.equal(runtime.openLiveTab().success, true);
  assert.equal(runtime.openFirstLive().success, true);
  assert.equal(runtime.nextLive().success, true);
  assert.deepEqual(events, ["openDouyin", "openSearchEntry", "keyword:crop", "submitSearch", "openLiveTab", "openFirstLive", "nextLive"]);
});

test("runtime refreshes and clears device action timing between actions", function () {
  var slept = 0;
  var context = { deviceProfile: { values: { commentActionTiming: {
    schemaVersion: 1, enabled: true, actions: { openDouyin: { beforeMs: [1, 1], afterMs: [2, 2] } }
  } } } };
  var runtime = createRuntime(context, { navigation: { openDouyin: function () { return { success: true }; } },
    sleep: function (milliseconds) { slept += milliseconds; }, random: function (min) { return min; } });
  assert.equal(runtime.openDouyin().success, true);
  assert.equal(slept, 3);
  context.deviceProfile.values.commentActionTiming = {
    schemaVersion: 1, enabled: true, actions: { openDouyin: { beforeMs: [3, 3], afterMs: [4, 4] } }
  };
  assert.equal(runtime.openDouyin().success, true);
  assert.equal(slept, 10);
  delete context.deviceProfile.values.commentActionTiming;
  assert.equal(runtime.openDouyin().success, true);
  assert.equal(slept, 5010);
});
