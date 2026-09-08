"use strict";
var assert = require("node:assert/strict");
var test = require("node:test");
var createWorkflow = require("../features/new-comment/workflow.js").createIsolatedLiveCommentWorkflow;
var createRuntime = require("../features/new-comment/runtime.js").createIsolatedRuntime;

function runRooms(rooms, options) {
  options = options || {};
  var room = 0;
  var actions = [];
  var scopes = [];
  var stopped = false;
  function record(name, value) { return function () { actions.push(name + ":" + room); return value; }; }
  var runtime = {
    openDouyin: record("open", true), openSearch: record("search", true),
    openLiveTab: record("tab", true), openFirstLive: record("first", true),
    waitRandom: function () { return true; },
    readViewerCount: function () { actions.push("viewers:" + room); return { count: rooms[room].count }; },
    readCommerceCart: function () {
      actions.push("cart:" + room);
      return rooms[room].cartError ? { success: false, reason: "TEMPLATE_MATCH_FAILED" }
        : { detected: !!rooms[room].cart };
    },
    openAnchorSummary: record("summary", true), openAnchorProfile: record("profile", true),
    readRoomIdentity: function () {
      actions.push("name:" + room);
      return { text: "Same profile text", screenshotSaved: true, ocrExecuted: true, ocrSucceeded: true };
    },
    closeAnchorProfile: record("back", true),
    nextLive: function () { actions.push("switch:" + room); room += 1; stopped = room >= rooms.length; return true; }
  };
  var result = createWorkflow({
    runtime: runtime, continueAfterCapture: !!options.continueAfterCapture,
    commentRunner: { capture: function (scope) {
      actions.push("capture:" + room); scopes.push(scope);
      return { status: "LIVE_COMMENT_ENTRY_ENTERED", captureCompleted: true, comments: [] };
    } }
  }).run({ targetKeyword: "crop", minViewerCount: 10, batchId: "batch", maxRoomAttempts: 5 }, {
    shouldStop: function () { return stopped; }
  });
  return { result: result, actions: actions.slice(4), scopes: scopes };
}

test("below-threshold viewers skip cart and profile scans", function () {
  var output = runRooms([{ count: 5 }, { count: 10 }]);
  assert.equal(output.result.captureCompleted, true);
  assert.deepEqual(output.actions, ["viewers:0", "switch:0", "viewers:1", "cart:1",
    "summary:1", "profile:1", "name:1", "back:1", "capture:1"]);
});

test("cart detected after qualifying viewers skips directly to next room", function () {
  var output = runRooms([{ count: 30, cart: true }, { count: 30 }]);
  assert.equal(output.result.captureCompleted, true);
  assert.deepEqual(output.actions.slice(0, 6), ["viewers:0", "cart:0", "switch:0", "viewers:1", "cart:1", "summary:1"]);
});

test("cart scan failure does not pass the room filter", function () {
  var output = runRooms([{ count: 30, cartError: true }, { count: 30 }]);
  assert.equal(output.result.captureCompleted, true);
  assert.equal(output.actions.includes("summary:0"), false);
  assert.equal(output.actions.includes("capture:0"), false);
  assert.equal(output.actions.includes("switch:0"), true);
});

test("completed capture switches without a second back tap", function () {
  var output = runRooms([{ count: 30 }], { continueAfterCapture: true });
  assert.equal(output.result.status, "STOPPED");
  assert.deepEqual(output.actions.slice(-3), ["back:0", "capture:0", "switch:0"]);
  assert.equal(output.actions.filter(function (action) { return action === "back:0"; }).length, 1);
});

test("single-device capture needs no lease methods and separates same-name visits", function () {
  var output = runRooms([{ count: 30 }, { count: 30 }], { continueAfterCapture: true });
  assert.equal(output.scopes.length, 2);
  assert.deepEqual(output.scopes.map(function (scope) { return scope.roomKey; }), ["capture:1", "capture:2"]);
  assert.equal(output.scopes[0].accountName, output.scopes[1].accountName);
});

function screenRuntime(settings) {
  settings = settings || {};
  var captures = 0;
  var matches = 0;
  var runtime = createRuntime({}, {
    captureScreen: function () {
      captures += 1;
      if (settings.captureError) throw new Error("capture unavailable");
      return { recycle: function () {} };
    },
    commerceCartTemplate: {},
    images: {
      clip: function () { return { recycle: function () {} }; },
      matchTemplate: function () {
        matches += 1;
        if (settings.matchError) throw new Error("match unavailable");
        return { similarity: settings.similarity || 0 };
      }
    },
    ocrEngine: { recognize: function () { return "5"; } },
    viewerCountParser: { parseViewerBadgeCount: function () { return 5; } }
  });
  return { runtime: runtime, captures: function () { return captures; }, matches: function () { return matches; } };
}

test("viewer OCR runtime performs no cart matching or second screenshot", function () {
  var fixture = screenRuntime();
  assert.equal(fixture.runtime.readViewerCount().value.count, 5);
  assert.equal(fixture.captures(), 1);
  assert.equal(fixture.matches(), 0);
});

test("independent cart scan reports detected and absent results", function () {
  [0.1, 0.8].forEach(function (similarity) {
    var fixture = screenRuntime({ similarity: similarity });
    var result = fixture.runtime.readCommerceCart();
    assert.equal(result.success, true);
    assert.equal(result.value.detected, similarity >= 0.5);
    assert.equal(fixture.matches(), 1);
  });
});

test("cart capture and template errors are explicit scan failures", function () {
  [{ captureError: true }, { matchError: true }].forEach(function (settings) {
    assert.equal(screenRuntime(settings).runtime.readCommerceCart().success, false);
  });
  assert.equal(createRuntime({}).readCommerceCart().success, false);
});
