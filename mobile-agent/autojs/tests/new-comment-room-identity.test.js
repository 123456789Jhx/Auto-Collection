"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var parseIdentity = require("../features/new-comment/room-identity.js").roomIdentityFromText;
var createWorkflow = require("../features/new-comment/workflow.js").createIsolatedLiveCommentWorkflow;

function identify(text) {
  var result = parseIdentity(text);
  return result ? { success: true, value: result } : { success: false, reason: "OCR_FAILED" };
}

test("anchor name keeps the same lease key with missing or unstable account OCR", function () {
  ["", "\n抖音号：", "\n抖音号：abc123", "\n抖音号：a8c12", " 抖音号：abc123"].forEach(function (suffix) {
    var result = identify("花姐讲种植" + suffix);
    assert.equal(result.success, true);
    assert.equal(result.value.roomKey, "anchor:花姐讲种植");
    assert.equal(result.value.accountName, "花姐讲种植");
  });
  assert.equal(identify("花姐讲种植\n抖音号：abc123").value.accountId, "abc123");
  assert.equal(identify("花姐讲种植\n抖音号：").value.accountId, "");
});

test("English and numeric anchor names are accepted before the account label", function () {
  ["Alice", "12345"].forEach(function (name) {
    var result = identify(name + "\n抖音号：different-id");
    assert.equal(result.success, true);
    assert.equal(result.value.accountName, name);
    assert.equal(result.value.roomKey, "anchor:" + name.toLowerCase());
  });
});

test("account labels inside an anchor name do not truncate its identity", function () {
  ["小抖音号种植", "小抖音号课堂", "抖音号养成计划"].forEach(function (name) {
    ["", "\n抖音号：abc123", " 抖音号：abc123"].forEach(function (suffix) {
      var result = identify(name + suffix);
      assert.equal(result.success, true);
      assert.equal(result.value.roomKey, "anchor:" + name);
      assert.equal(result.value.accountName, name);
    });
  });
});

test("anchor keys normalize width, whitespace and case", function () {
  var result = identify("  Ａｌｉｃｅ　 Farm \r\n抖音号：ＡＢＣ１２３");
  assert.equal(result.success, true);
  assert.equal(result.value.accountName, "Alice Farm");
  assert.equal(result.value.roomKey, "anchor:alice farm");
  assert.equal(result.value.accountId, "ABC123");
});

test("empty names and profile labels still fail identity parsing", function () {
  ["", "   ", "关注\n粉丝\n获赞", "---", "a".repeat(201)]
    .forEach(function (text) {
      var result = identify(text);
      assert.equal(result.success, false, JSON.stringify(text));
      assert.equal(result.reason, "OCR_FAILED");
    });
});

test("account-only OCR no longer fails when the name is absent", function () {
  ["抖音号：123456", "抖音号：abc123", "抖音号：\nabc123"].forEach(function (text) {
    var result = identify(text);
    assert.equal(result.success, true, text);
    assert.equal(result.value.text, text.replace("：", ":"));
    assert.ok(result.value.accountName);
  });
});

test("a name following an account line remains available to the parser", function () {
  var result = identify("抖音号：123456\n花姐讲种植");
  assert.equal(result.success, true);
  assert.equal(result.value.accountName, "花姐讲种植");
  assert.equal(result.value.accountId, "123456");
});

test("plain business text needs no account label or digits", function () {
  var result = identify("优而鲜农业特菜基地\n店铺授权号\n优而鲜农业授权资质");
  assert.equal(result.success, true);
  assert.equal(result.value.accountName, "优而鲜农业特菜基地");
  assert.equal(result.value.accountId, "");
  assert.equal(result.value.text, "优而鲜农业特菜基地\n店铺授权号\n优而鲜农业授权资质");
});

test("legacy JavaScript engines can normalize full-width anchor names", function () {
  var fs = require("node:fs");
  var vm = require("node:vm");
  var filename = require.resolve("../features/new-comment/room-identity.js");
  var sandbox = { module: { exports: {} } };
  vm.runInNewContext("String.prototype.normalize = undefined;\n" + fs.readFileSync(filename, "utf8"), sandbox);
  var identity = sandbox.module.exports.roomIdentityFromText("Ａｌｉｃｅ　Ｆａｒｍ\n抖音号：");
  assert.equal(identity.roomKey, "anchor:alice farm");
});

test("room names stay scoped in progress, completed and interrupted captures across room switches", function () {
  var clock = 0;
  var room = 0;
  var stopRequested = false;
  var actions = [];
  var stages = [];
  var claimed = [];
  var released = [];
  function action(name) { return function () { actions.push(name + ":" + room); return true; }; }
  var runtime = {
    openDouyin: action("openDouyin"),
    openSearch: action("openSearch"),
    openLiveTab: action("openLiveTab"),
    openFirstLive: action("openFirstLive"),
    isLiveRoom: function () { throw new Error("unexpected room confirmation"); },
    readViewerCount: function () {
      actions.push("readViewerCount:" + room);
      return { count: 500, commerceCartVisible: false };
    },
    openAnchorSummary: action("openAnchorSummary"),
    openAnchorProfile: action("openAnchorProfile"),
    readRoomIdentity: function () {
      return identify(room === 0 ? "花姐讲种植\n抖音号：abc123" : "Alice\n抖音号：");
    },
    claimRoom: function (key, batch) {
      claimed.push([key, batch]);
      return { acquired: true, roomKey: key };
    },
    closeAnchorProfile: action("closeAnchorProfile"),
    readComments: function () {
      actions.push("readComments:" + room);
      if (room === 1) stopRequested = true;
      return { text: "用户：这个怎么种" };
    },
    swipeComments: function () { clock += 300000; return true; },
    nextLive: function () { room += 1; return true; },
    releaseRoom: function (key) { released.push(key); return { released: true }; },
    waitRandom: function () { return true; }
  };
  var result = createWorkflow({
    runtime: runtime,
    deviceId: "device-1",
    continueAfterCapture: true,
    now: function () { return clock; },
    reportStage: function (event) { stages.push(event); }
  }).run({ batchId: "batch-1", targetKeyword: "种植", commentSwipeCount: 1 }, {
    shouldStop: function () { return stopRequested; }
  });
  assert.equal(result.status, "STOPPED");
  assert.equal(result.captureCompleted, false);
  assert.equal(result.comments.length, 2);
  assert.deepEqual(claimed, [["anchor:花姐讲种植", "batch-1"], ["anchor:alice", "batch-1"]]);
  assert.deepEqual(released, ["anchor:花姐讲种植", "anchor:alice"]);
  assert.notEqual(result.comments[0].commentId, result.comments[1].commentId);
  result.comments.forEach(function (comment, index) {
    assert.equal(comment.batchId, "batch-1");
    assert.equal(comment.deviceId, "device-1");
    assert.equal(comment.roomKey, index === 0 ? "anchor:花姐讲种植" : "anchor:alice");
    assert.equal(comment.accountName, index === 0 ? "花姐讲种植" : "Alice");
    assert.equal(comment.accountId, index === 0 ? "abc123" : undefined);
    comment.sources.forEach(function (source) {
      assert.equal(source.roomKey, comment.roomKey);
      assert.equal(source.deviceId, "device-1");
      assert.equal(source.accountName, comment.accountName);
      assert.equal(source.accountId, comment.accountId);
    });
    assert.equal(actions.filter(function (item) { return item === "readViewerCount:" + index; }).length, 1);
    var closed = actions.indexOf("closeAnchorProfile:" + index);
    assert.ok(closed >= 0);
    assert.equal(actions[closed + 1], "readComments:" + index);
  });
  var complete = stages.find(function (event) { return event.stage === "COMMENTS_CAPTURED"; });
  assert.equal(complete.captureCompleted, true);
  assert.equal(complete.comments[0].accountName, "花姐讲种植");
  var progress = stages.filter(function (event) { return event.stage === "COMMENT_PAGE_CAPTURED"; });
  assert.ok(progress.length > 0);
  assert.equal(progress[0].comments[0].sources[0].accountName, "花姐讲种植");
});
