"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var createNavigation = require("../features/new-comment/navigation.js").createCommentNavigation;

function base(overrides) {
  var options = {
    screenSize: function () { return { width: 1000, height: 2000 }; },
    random: function (min) { return min; }, shouldStop: function () { return false; },
    sleep: function () {}, findNode: function () { return null; },
    driver: function () { return { tap: function () { return true; }, swipe: function () { return true; } }; }
  };
  Object.keys(overrides || {}).forEach(function (key) { options[key] = overrides[key]; });
  return options;
}

test("navigation rejects false and undefined gesture dispatch", function () {
  [false, undefined].forEach(function (result) {
    var nav = createNavigation(base({ driver: function () { return {
      tap: function () { return result; }, swipe: function () { return result; }
    }; } }));
    assert.equal(nav.openFirstLive().success, false);
    assert.equal(nav.nextLive().success, false);
  });
});

test("live-tab lookup rejects matching text in the content area", function () {
  var taps = 0;
  var nav = createNavigation(base({ lookupTimeoutMs: 100,
    findNode: function () { return { bounds: function () { return { left: 10, top: 900, right: 100, bottom: 1000 }; } }; },
    driver: function () { return { tap: function () { taps += 1; return true; } }; }
  }));
  assert.equal(nav.openLiveTab().reason, "NODE_TIMEOUT");
  assert.equal(taps, 0);
});

test("selector predicate chooses a top control when the same text appears in content", function () {
  var tapped = null;
  var nodes = [{ bounds: function () { return { left: 10, top: 900, right: 100, bottom: 1000 }; } },
    { bounds: function () { return { left: 800, top: 100, right: 900, bottom: 160 }; } }];
  var nav = createNavigation(base({
    findNode: function (description, predicate) { return nodes.filter(predicate)[0]; },
    driver: function () { return { tap: function (point) { tapped = point; return true; } }; }
  }));
  assert.equal(nav.openLiveTab().success, true);
  assert.deepEqual(tapped, { x: 850, y: 130, durationMs: 180 });
});

test("launch returns without a duplicate readiness wait and reports an unconfirmed foreground", function () {
  var slices = [];
  var nav = createNavigation(base({ launchPackage: function () { return true; },
    currentPackage: function () { return "android"; },
    sleep: function (milliseconds) { slices.push(milliseconds); }
  }));
  var result = nav.openDouyin();
  assert.equal(result.success, true);
  assert.equal(result.value.confirmed, false);
  assert.deepEqual(slices, []);
});

test("search coordinate fallback is blocked outside Douyin", function () {
  var taps = 0;
  var nav = createNavigation(base({ currentPackage: function () { return "android"; },
    driver: function () { return { tap: function () { taps += 1; return true; } }; }
  }));
  assert.equal(nav.openSearchEntry().reason, "NODE_TIMEOUT");
  assert.equal(taps, 0);
});
