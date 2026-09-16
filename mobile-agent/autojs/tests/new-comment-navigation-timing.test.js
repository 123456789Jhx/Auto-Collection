"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var createNavigation = require("../features/new-comment/navigation.js").createCommentNavigation;

function fixture() {
  var events = [], keyword = "", stopped = false;
  var node = { bounds: function () { return { left: 850, top: 100, right: 960, bottom: 150 }; },
    setText: function (text) { keyword = text; events.push("input"); return true; },
    text: function () { return keyword; } };
  var deps = { screenSize: function () { return { width: 1000, height: 2000 }; },
    config: { runtime: { swipeDurationMs: 480 } }, random: function (min) { return min; },
    shouldStop: function () { return stopped; }, sleep: function (ms) { events.push(["sleep", ms]); },
    findNode: function () { return node; }, launchPackage: function () { events.push("launch"); return true; },
    currentPackage: function () { return "com.ss.android.ugc.aweme"; },
    driver: function () { return {
      tap: function (value) { events.push(["tap", value]); return { success: true }; },
      swipe: function (value) { events.push(["swipe", value]); return { success: true }; }
    }; } };
  return { events: events, deps: deps, stop: function () { stopped = true; } };
}

test("navigation emits actions without shared adapter post-click sleeps", function () {
  var f = fixture(), nav = createNavigation(f.deps);
  assert.equal(nav.openDouyin().success, true);
  assert.equal(nav.openSearchEntry().success, true);
  assert.equal(nav.setSearchKeyword("农业").success, true);
  assert.equal(nav.submitSearch().success, true);
  assert.equal(nav.openLiveTab().success, true);
  assert.equal(nav.openFirstLive().success, true);
  assert.equal(nav.nextLive().success, true);
  assert.equal(f.events.some(function (event) { return Array.isArray(event) && event[0] === "sleep"; }), false);
  var swipe = f.events.filter(function (event) { return event[0] === "swipe"; })[0][1];
  assert.deepEqual(swipe.points, [{ x: 500, y: 1560 }, { x: 500, y: 440 }]);
  assert.equal(swipe.durationMs, 480);
});

test("first-room click preserves random content area across screen sizes", function () {
  var f = fixture();
  f.deps.random = function (min, max) { return max; };
  createNavigation(f.deps).openFirstLive();
  assert.deepEqual(f.events[0][1], { x: 860, y: 1300, durationMs: 180 });
});

test("stop prevents launch, click, input and room swipe", function () {
  var f = fixture(), nav = createNavigation(f.deps); f.stop();
  [nav.openDouyin, nav.openSearchEntry, function () { return nav.setSearchKeyword("test"); },
    nav.submitSearch, nav.openLiveTab, nav.openFirstLive, nav.nextLive].forEach(function (fn) {
    assert.equal(fn().reason, "STOP_REQUESTED");
  });
  assert.deepEqual(f.events, []);
});

test("missing live tab has finite cancellable lookup and never guesses a click", function () {
  var f = fixture(); f.deps.findNode = function () { return null; };
  var result = createNavigation(f.deps).openLiveTab();
  assert.equal(result.success, false);
  assert.equal(f.events.filter(function (event) { return event[0] === "tap"; }).length, 0);
  var sleeps = f.events.filter(function (event) { return event[0] === "sleep"; });
  assert.ok(sleeps.length <= 15);
  assert.ok(sleeps.every(function (event) { return event[1] <= 100; }));
});

test("launch rejection and keyword mismatch fail explicitly", function () {
  var f = fixture(); f.deps.launchPackage = function () { return false; };
  assert.equal(createNavigation(f.deps).openDouyin().success, false);
  f.deps.findNode = function () { return { setText: function () { return true; }, text: function () { return "旧关键词"; } }; };
  assert.equal(createNavigation(f.deps).setSearchKeyword("新关键词").success, false);
});
