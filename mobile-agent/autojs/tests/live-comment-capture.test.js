var assert = require("assert");
var capture = require("../domain/live-comment-capture.js");
var accessibility = require("../core/accessibility.js");
var runtimeModule = require("../features/account-warmup/live-comment-entry-runtime.js");
var fastSearchModule = require("../features/account-warmup/fast-target-search.js");

function FakePath() {
  this.operations = [];
}

FakePath.prototype.moveTo = function (x, y) {
  this.operations.push(["moveTo", x, y]);
};

FakePath.prototype.lineTo = function (x, y) {
  this.operations.push(["lineTo", x, y]);
};

function FakeStrokeDescription(path, startTime, durationMs) {
  this.path = path;
  this.startTime = startTime;
  this.durationMs = durationMs;
}

function FakeGestureBuilder() {
  this.strokes = [];
}

FakeGestureBuilder.prototype.addStroke = function (stroke) {
  this.strokes.push(stroke);
  return this;
};

FakeGestureBuilder.prototype.build = function () {
  return { strokes: this.strokes };
};

var FakeGestureDescription = {
  StrokeDescription: FakeStrokeDescription,
  Builder: FakeGestureBuilder
};

function testAccessibilityGestureDriverBuildsAPath() {
  var dispatched = null;
  var driver = accessibility.createGestureDriver({
    service: {
      dispatchGesture: function (gesture) {
        dispatched = gesture;
        return true;
      }
    },
    Path: FakePath,
    GestureDescription: FakeGestureDescription
  });

  assert.deepStrictEqual(driver.swipe({
    points: [{ x: 12, y: 120 }, { x: 12, y: 80 }],
    durationMs: 180
  }), { success: true });
  assert.deepStrictEqual(dispatched.strokes[0].path.operations, [
    ["moveTo", 12, 120],
    ["lineTo", 12, 80]
  ]);
  assert.strictEqual(dispatched.strokes[0].durationMs, 180);
}

function testRuntimeUsesTheInjectedGestureDriverForCommentSwipe() {
  var calls = [];
  var previousSwipe = global.swipe;
  global.swipe = function () {
    throw new Error("comment runtime must not call legacy swipe");
  };
  try {
    var runtime = runtimeModule.createDefaultRuntime({
      screenSize: function () { return { width: 1080, height: 2248 }; },
      screenRecognizer: { extractScreen: function () { return { ocrRegions: {} }; } },
      gestureDriver: {
        swipe: function (input) {
          calls.push(input);
          return { success: true };
        }
      }
    });
    assert.strictEqual(runtime.swipeComments(), true);
  } finally {
    if (previousSwipe === undefined) delete global.swipe;
    else global.swipe = previousSwipe;
  }

  var coordinates = capture.commentSwipeCoordinates({ width: 1080, height: 2248 });
  assert.deepStrictEqual(calls, [{
    points: [
      { x: coordinates.startX, y: coordinates.startY },
      { x: coordinates.endX, y: coordinates.endY }
    ],
    durationMs: coordinates.durationMs
  }]);
}

function testLiveCommentActionsUseGestureDriverForTapAndRoomSwipe() {
  var calls = [];
  var runtime = runtimeModule.createDefaultRuntime({
    screenSize: function () { return { width: 1080, height: 2248 }; },
    screenRecognizer: { extractScreen: function () { return { ocrRegions: {} }; } },
    gestureDriver: {
      tap: function (input) { calls.push({ type: "tap", input: input }); return { success: true }; },
      swipe: function (input) { calls.push({ type: "swipe", input: input }); return { success: true }; }
    }
  });

  var previousClick = global.click;
  global.click = function () { throw new Error("live comment runtime must not call legacy click"); };
  try {
    assert.strictEqual(runtime.openLiveTab(), false);
    assert.strictEqual(runtime.openFirstLive(), true);
    assert.strictEqual(runtime.nextLive(), true);
  } finally {
    if (previousClick === undefined) delete global.click;
    else global.click = previousClick;
  }

  assert.deepStrictEqual(calls, [
    { type: "tap", input: { x: 388, y: 786, durationMs: 180 } },
    {
      type: "swipe",
      input: {
        points: [{ x: 540, y: 1753 }, { x: 540, y: 494 }],
        durationMs: 520
      }
    }
  ]);
}

function testLiveCommentLiveTabUsesGestureTap() {
  var previousText = global.text;
  var taps = [];
  global.text = function () {
    return {
      find: function () {
        return [{
          bounds: function () {
            return {
              centerX: function () { return 540; },
              centerY: function () { return 300; }
            };
          },
          click: function () { throw new Error("live tab must not call node.click"); }
        }];
      }
    };
  };
  try {
    var runtime = runtimeModule.createDefaultRuntime({
      screenSize: function () { return { width: 1080, height: 2248 }; },
      gestureDriver: { tap: function (input) { taps.push(input); return { success: true }; } }
    });
    assert.strictEqual(runtime.openLiveTab(), true);
  } finally {
    if (previousText === undefined) delete global.text;
    else global.text = previousText;
  }
  assert.deepStrictEqual(taps, [{ x: 540, y: 300, durationMs: 180 }]);
}

function testFastSearchUsesGestureDriverForSearchClicks() {
  var taps = [];
  var node = {
    clickable: function () { return true; },
    bounds: function () {
      return { centerX: function () { return 900; }, centerY: function () { return 140; } };
    },
    setText: function () { return true; }
  };
  var search = fastSearchModule.createFastTargetSearch({
    gestureDriver: { tap: function (input) { taps.push(input); return { success: true }; } },
    dependencies: {
      now: function () { return 0; },
      sleep: function () {},
      screenSize: function () { return { width: 1080, height: 2248 }; },
      findSearchEntry: function () { return node; },
      findInput: function () { return node; },
      findSubmit: function () { return node; },
      clickNode: function () { throw new Error("legacy click dependency must be bypassed"); },
      clickPoint: function () { throw new Error("legacy click point must be bypassed"); },
      setInput: function () { return true; },
      pressEnter: function () { return true; },
      isResultFor: function () { return true; }
    }
  });

  assert.strictEqual(search.openSearch("中药材").success, true);
  assert.strictEqual(taps.length, 2);
}

function testCommentRegionAndSwipeStayInsideTheRedBox() {
  var regions = capture.commentOcrRegions({ width: 1080, height: 2248 });
  var region = regions.commentArea;
  var coordinates = capture.commentSwipeCoordinates({ width: 1080, height: 2248 });

  assert.deepStrictEqual(Object.keys(regions), ["commentArea"]);
  assert(region.x > 0 && region.y > 0);
  assert(region.x + region.w <= 1080);
  assert(region.y + region.h <= 2248);
  assert(coordinates.startX > region.x && coordinates.startX < region.x + region.w);
  assert(coordinates.endX > region.x && coordinates.endX < region.x + region.w);
  assert(coordinates.startY > coordinates.endY);
  assert(coordinates.startY < region.y + region.h);
  assert(coordinates.endY > region.y);
}

function testParsesOnlyTextAfterTheUsernameSeparator() {
  var comments = capture.parseCommentLines([
    "中药材：我每年来过来",
    "幸福安康 来了",
    "破局而立:关注你了",
    "燕麦@野想：地黄今年多少钱一斤",
    "说点什么"
  ].join("\n"));

  assert.deepStrictEqual(comments, [
    { userName: "中药材", commentText: "我每年来过来" },
    { userName: "破局而立", commentText: "关注你了" },
    { userName: "燕麦@野想", commentText: "地黄今年多少钱一斤" }
  ]);
}

function testJoinsAWrappedCommentUntilTheNextUsername() {
  assert.deepStrictEqual(capture.parseCommentLines([
    "中药材：主播，回关下，今年过来了",
    "我俩你学习学习",
    "破局而立：关注你了"
  ].join("\n")), [
    { userName: "中药材", commentText: "主播，回关下，今年过来了我俩你学习学习" },
    { userName: "破局而立", commentText: "关注你了" }
  ]);
}

function testFlattensPagesWithPageIndexes() {
  assert.deepStrictEqual(capture.flattenPages([
    { pageIndex: 0, comments: [{ userName: "甲", commentText: "你好" }] },
    { pageIndex: 1, comments: [{ userName: "乙", commentText: "欢迎" }] }
  ]), [
    { pageIndex: 0, userName: "甲", commentText: "你好" },
    { pageIndex: 1, userName: "乙", commentText: "欢迎" }
  ]);
}

function testBuildsStableScopedCandidatesAndKeepsDuplicateSources() {
  var scope = { batchId: "batch-1", deviceId: "device-1", roomKey: "room-1" };
  var pages = [
    { pageIndex: 0, comments: [
      { userName: "甲", commentText: "今年行情怎么样" },
      { userName: "乙", commentText: "独立评论" }
    ] },
    { pageIndex: 1, comments: [
      { userName: "丙", commentText: "今年 行情怎么样" }
    ] }
  ];

  var candidates = capture.buildCandidates(pages, scope);
  assert.strictEqual(candidates.length, 2);
  assert.deepStrictEqual(candidates[0], {
    commentId: capture.commentIdentity(scope, { commentText: "今年行情怎么样" }),
    batchId: "batch-1",
    deviceId: "device-1",
    roomKey: "room-1",
    pageIndex: 0,
    userName: "甲",
    commentText: "今年行情怎么样",
    sources: [
      { pageIndex: 0, userName: "甲", commentText: "今年行情怎么样" },
      { pageIndex: 1, userName: "丙", commentText: "今年 行情怎么样" }
    ]
  });
  assert.strictEqual(candidates[0].commentId, capture.buildCandidates(pages, scope)[0].commentId);
  assert.notStrictEqual(candidates[0].commentId, candidates[1].commentId);
}

testCommentRegionAndSwipeStayInsideTheRedBox();
testAccessibilityGestureDriverBuildsAPath();
testRuntimeUsesTheInjectedGestureDriverForCommentSwipe();
testLiveCommentActionsUseGestureDriverForTapAndRoomSwipe();
testLiveCommentLiveTabUsesGestureTap();
testFastSearchUsesGestureDriverForSearchClicks();
testParsesOnlyTextAfterTheUsernameSeparator();
testJoinsAWrappedCommentUntilTheNextUsername();
testFlattensPagesWithPageIndexes();
testBuildsStableScopedCandidatesAndKeepsDuplicateSources();
console.log("live comment capture tests passed");
