"use strict";
var assert = require("node:assert/strict");
var test = require("node:test");
var capture = require("../features/new-comment/comment-capture.js");
var createRunner = require("../features/new-comment/comment-runner.js").createCommentCaptureRunner;
var createWorkflow = require("../features/new-comment/workflow.js").createIsolatedLiveCommentWorkflow;

test("raw comments contain only each line's first-colon suffix without names or continuation", function () {
  var comments = capture.parseCommentLines("Alice: How much: per kg?\nno separator\nBob\uff1a next crop\nCharlie: \n: anonymous body");
  assert.deepEqual(comments, [{ commentText: "How much: per kg?" }, { commentText: "next crop" }, { commentText: "anonymous body" }]);
  var candidates = capture.buildCandidates([{ pageIndex: 0, comments: comments }], { batchId: "batch", deviceId: "device", roomKey: "anchor:room" });
  assert.equal(JSON.stringify(candidates).includes("userName"), false);
  assert.equal(JSON.stringify(candidates).includes("Alice"), false);
  assert.equal(candidates[0].commentText, "How much: per kg?");
  assert.equal(capture.buildCandidates([{ pageIndex: 0, comments: capture.parseCommentLines("Alice:" + "x".repeat(130)) }], {})[0].commentText.length, 130);
});

function timedRun(text, minutes, extra) {
  var clock = 0;
  var reads = [];
  var swipes = [];
  var leases = [];
  var events = [];
  var runtime = {
    readComments: function () { reads.push(clock); return { text: text }; },
    swipeComments: function () { swipes.push(clock); return true; },
    waitRandom: function (min) { clock += Math.max(1, min); return true; },
    claimRoom: function () { leases.push(clock); return { success: true, value: { acquired: true } }; }
  };
  if (extra) extra(runtime, function (value) { clock += value; });
  var result = createRunner({ runtime: runtime, captureDurationMinutes: minutes,
    now: function () { return clock; }, reportStage: function (event) { events.push(event); }
  }).capture({ roomKey: "anchor:room", batchId: "batch", deviceId: "device" });
  return { result: result, clock: clock, reads: reads, swipes: swipes, leases: leases, events: events };
}

function freshComments(runtime) {
  var index = 0;
  runtime.readComments = function () { index += 1; return { text: "comment " + index }; };
}

test("timer keeps collecting new pages beyond six swipes and stops at one minute", function () {
  var run = timedRun("", 1, freshComments);
  assert.equal(run.result.captureStopReason, "DURATION_REACHED");
  assert.equal(run.result.captureCompleted, true);
  assert.ok(run.swipes.length > 6);
  assert.equal(run.clock, 60000);
  assert.ok(run.reads.every(function (at) { return at < 60000; }));
  assert.ok(run.swipes.every(function (at) { return at < 60000; }));
});

test("empty pages without a history-end banner continue until the deadline", function () {
  var run = timedRun("", 1);
  assert.equal(run.result.captureStopReason, "DURATION_REACHED");
  assert.equal(run.result.captureCompleted, true);
  assert.equal(run.result.commentCount, 0);
  assert.ok(run.swipes.length > 3);
  assert.equal(run.clock, 60000);
});

test("five-minute capture renews the room lease before its three-minute expiry", function () {
  var run = timedRun("", 5, freshComments);
  assert.equal(run.result.captureStopReason, "DURATION_REACHED");
  assert.equal(run.clock, 300000);
  assert.ok(run.leases.length >= 4);
  var last = 0;
  run.leases.forEach(function (at) { assert.ok(at - last < 180000); last = at; });
});

test("expired OCR does not initiate another read or swipe", function () {
  var run = timedRun("", 1, function (runtime, advance) {
    runtime.readComments = function () { advance(61000); return { text: "late comment" }; };
  });
  assert.equal(run.result.captureStopReason, "DURATION_REACHED");
  assert.equal(run.result.commentCount, 0);
  assert.equal(run.swipes.length, 0);
});

test("lease renewal conflict stops collecting instead of running without ownership", function () {
  var run = timedRun("same comment", 5, function (runtime) {
    freshComments(runtime);
    runtime.claimRoom = function () { return { success: true, value: { acquired: false, ownerDeviceId: "other-device" } }; };
  });
  assert.equal(run.result.reasonCode, "ROOM_LEASE_UNAVAILABLE");
  assert.ok(run.clock < 180000);
});

test("a history-end banner ends duplicate capture at the first confirmed swipe", function () {
  var run = timedRun("same comment", 5, function (runtime) {
    runtime.swipeComments = function () { return { success: true, value: { endDetected: true } }; };
  });
  assert.equal(run.result.captureStopReason, "COMMENT_HISTORY_END");
  assert.equal(run.result.captureCompleted, true);
  assert.equal(run.result.commentCount, 1);
  assert.equal(run.result.commentSwipeCount, 1);
  assert.equal(run.reads.length, 1);
  assert.equal(run.clock, 0);
});

test("changing and duplicate bodies continue until the banner is found", function () {
  var bodies = ["first", "first", "first", "second", "second", "second", "second"];
  var index = 0;
  var run = timedRun("", 5, function (runtime) {
    runtime.readComments = function () { return { text: bodies[Math.min(index++, bodies.length - 1)] }; };
    runtime.swipeComments = function () { return { success: true, value: { endDetected: index === 7 } }; };
  });
  assert.equal(run.result.captureStopReason, "COMMENT_HISTORY_END");
  assert.equal(run.result.commentCount, 7);
  assert.equal(run.result.commentSwipeCount, 7);
});

test("OCR failures retry then fail rather than ending as no-new-comments", function () {
  var reads = 0;
  var run = timedRun("", 5, function (runtime) {
    runtime.readComments = function () {
      reads += 1;
      if (reads <= 3) return { text: "first" };
      throw new Error("OCR unavailable");
    };
  });
  assert.equal(run.result.reasonCode, "COMMENT_OCR_FAILED");
  assert.equal(run.result.captureStopReason, undefined);
  assert.equal(run.swipes.length, 3);
  assert.equal(reads, 6);
  assert.equal(run.events.filter(function (event) { return event.stage === "COMMENT_PAGE_CAPTURED"; }).length, 3);
});

test("workflow switches after a history-end banner without another comment read", function () {
  var clock = 0;
  var room = 0;
  var stopped = false;
  var actions = [];
  var completed = null;
  function ok() { return true; }
  var runtime = {
    openDouyin: ok, openSearch: ok, openLiveTab: ok, openFirstLive: ok,
    openAnchorSummary: ok, openAnchorProfile: ok,
    closeAnchorProfile: function () { actions.push("return"); return true; },
    readViewerCount: function () {
      actions.push("screen:" + room);
      if (room === 1) stopped = true;
      return { count: 500, commerceCartVisible: false };
    },
    readRoomIdentity: function () { return { text: "room" }; },
    claimRoom: function () { return { acquired: true }; },
    readComments: function () { actions.push("read"); return { text: "same body" }; },
    swipeComments: function () { actions.push("swipe"); return { success: true, value: { endDetected: true } }; },
    waitRandom: function (min) { actions.push("wait"); clock += min; return true; },
    releaseRoom: function () { actions.push("release"); return true; },
    nextLive: function () { actions.push("switch"); room += 1; return true; }
  };
  var result = createWorkflow({ runtime: runtime, continueAfterCapture: true,
    now: function () { return clock; }, reportStage: function (event) {
      if (event.stage === "COMMENTS_CAPTURED") completed = event;
    }
  }).run({ batchId: "batch", targetKeyword: "crop", captureDurationMinutes: 5 }, {
    shouldStop: function () { return stopped; }
  });
  assert.equal(result.status, "STOPPED");
  assert.equal(completed.captureStopReason, "COMMENT_HISTORY_END");
  assert.equal(completed.swipeCount, 1);
  assert.equal(completed.comments[0].commentText, "same body");
  assert.equal(actions.filter(function (action) { return action === "screen:0"; }).length, 1);
  var swipeIndex = actions.indexOf("swipe");
  assert.deepEqual(actions.slice(swipeIndex, swipeIndex + 3), ["swipe", "wait", "switch"]);
  assert.ok(clock < 300000);
});

test("all four separators preserve every occurrence and body punctuation", function () {
  var parsed = capture.parseCommentLines("Alice: same\nBob\uff1a same\nCarol; same\nDave\uff1b same\nAlice: a:b;c\nno separator");
  assert.deepEqual(parsed.map(function (item) { return item.commentText; }), ["same", "same", "same", "same", "a:b;c"]);
  var raw = capture.buildCandidates([{ pageIndex: 0, comments: parsed }, { pageIndex: 1, comments: parsed }], {});
  assert.equal(raw.length, 10);
  assert.equal(JSON.stringify(raw).includes("userName"), false);
  assert.equal(new Set(raw.map(function (item) { return item.commentId; })).size, 10);
});
