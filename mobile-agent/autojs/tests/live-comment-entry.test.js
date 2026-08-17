var assert = require("assert");
var createLiveCommentEntryTask = require("../features/account-warmup/live-comment-entry.js").createLiveCommentEntryTask;

function createRuntime(overrides) {
  var events = [];
  var runtime = {
    openDouyin: function () { events.push("openDouyin"); return true; },
    openSearch: function (keyword) { events.push("openSearch:" + keyword); return true; },
    openLiveTab: function () { events.push("openLiveTab"); return true; },
    openFirstLive: function () { events.push("openFirstLive"); return true; },
    isLiveRoom: function () { events.push("isLiveRoom"); return true; },
    waitRandom: function () { events.push("waitRandom"); },
    restartSearch: function () { events.push("restartSearch"); return true; }
  };
  Object.assign(runtime, overrides || {});
  runtime.events = events;
  return runtime;
}

function runTask(runtime, payload, control, stages) {
  stages = stages || [];
  return createLiveCommentEntryTask({
    runtime: runtime,
    reportStage: function (event) { stages.push(event); }
  }).run(payload || { targetKeyword: "药材种植" }, control || { shouldStop: function () { return false; } });
}

function testEntersLiveRoomThroughIndependentStateMachine() {
  var runtime = createRuntime();
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "药材种植" }, null, stages);

  assert.deepStrictEqual(result, { status: "LIVE_COMMENT_ENTRY_ENTERED" });
  assert.deepStrictEqual(runtime.events.filter(function (event) { return event !== "waitRandom"; }), [
    "openDouyin",
    "openSearch:药材种植",
    "openLiveTab",
    "openFirstLive",
    "isLiveRoom"
  ]);
  assert.deepStrictEqual(stages.map(function (event) { return event.stage; }), [
    "OPENING_DOUYIN",
    "OPENING_SEARCH",
    "INPUT_KEYWORD",
    "OPENING_LIVE_TAB",
    "OPENING_FIRST_RESULT",
    "ENTERED"
  ]);
}

function testRetriesSearchOnlyOnceWhenFirstResultIsMissing() {
  var attempts = 0;
  var runtime = createRuntime({
    openFirstLive: function () {
      attempts += 1;
      return attempts === 2;
    }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.deepStrictEqual(result, { status: "LIVE_COMMENT_ENTRY_ENTERED" });
  assert.strictEqual(attempts, 2);
  assert.strictEqual(runtime.events.filter(function (event) { return event === "restartSearch"; }).length, 1);
  assert.strictEqual(stages.filter(function (event) { return event.stage === "RETRYING_SEARCH"; }).length, 1);
}

function testReportsFailureAfterOneRetry() {
  var runtime = createRuntime({
    openFirstLive: function () { return false; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
  assert.strictEqual(result.failedStage, "OPENING_FIRST_RESULT");
  assert.strictEqual(typeof result.message, "string");
  assert.strictEqual(stages[stages.length - 1].stage, "FAILED");
}

function testDoesNotRetryWhenClickedResultIsNotConfirmedAsLiveRoom() {
  var runtime = createRuntime({
    isLiveRoom: function () { return false; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
  assert.strictEqual(result.failedStage, "OPENING_FIRST_RESULT");
  assert.strictEqual(runtime.events.filter(function (event) { return event === "restartSearch"; }).length, 0);
}

function testClickFailureDoesNotRetrySearch() {
  var restartAttempts = 0;
  var runtime = createRuntime({
    openFirstLive: function () { return { success: false, reason: "CLICK_FAILED" }; },
    restartSearch: function () { restartAttempts += 1; return true; }
  });
  var result = runTask(runtime, { targetKeyword: "关键词" });

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
  assert.strictEqual(result.failedStage, "OPENING_FIRST_RESULT");
  assert.strictEqual(restartAttempts, 0);
}

function testDefaultRuntimeReportsNoResultWhenFirstLiveProbeFindsNothing() {
  var originalClick = global.click;
  var originalSleep = global.sleep;
  var clickAttempts = 0;
  global.click = function () { clickAttempts += 1; return true; };
  global.sleep = function () {};
  try {
    var task = createLiveCommentEntryTask({
      context: {
        douyin: {
          openApp: function () { return true; },
          openLiveTab: function () { return true; },
          findFirstLive: function () { return null; },
          isLiveRoomVisible: function () { return true; }
        }
      },
      fastSearch: { openSearch: function () { return true; } }
    });
    var result = task.run({ targetKeyword: "关键词" });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
    assert.strictEqual(result.failedStage, "OPENING_FIRST_RESULT");
    assert.strictEqual(clickAttempts, 0);
  } finally {
    global.click = originalClick;
    global.sleep = originalSleep;
  }
}

function testStopsBeforeOpeningWhenControlRequestsStop() {
  var runtime = createRuntime();
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, { shouldStop: function () { return true; } }, stages);

  assert.deepStrictEqual(result, { status: "STOPPED" });
  assert.deepStrictEqual(runtime.events, []);
  assert.strictEqual(stages.length, 0);
}

function testDefaultRuntimeUsesCurrentScreenSizeForFirstLiveCard() {
  var originalDevice = global.device;
  var originalClick = global.click;
  var originalSleep = global.sleep;
  var clicked = null;
  global.device = { width: 1080, height: 2248 };
  global.click = function (x, y) { clicked = [x, y]; return true; };
  global.sleep = function () {};
  try {
    var task = createLiveCommentEntryTask({
      context: {
        douyin: {
          openApp: function () { return true; },
          openLiveTab: function () { return true; },
          isLiveRoomVisible: function () { return true; }
        }
      },
      fastSearch: { openSearch: function () { return { success: true }; } }
    });

    assert.deepStrictEqual(task.run({ targetKeyword: "关键词" }), { status: "LIVE_COMMENT_ENTRY_ENTERED" });
    assert.deepStrictEqual(clicked, [Math.floor(1080 * 0.36), Math.floor(2248 * 0.35)]);
  } finally {
    global.device = originalDevice;
    global.click = originalClick;
    global.sleep = originalSleep;
  }
}

function testRetriesOnceWhenFastSearchHasNoResults() {
  var searchAttempts = 0;
  var restartAttempts = 0;
  var runtime = createRuntime({
    openSearch: function () {
      searchAttempts += 1;
      return { success: false, stage: "result_wait" };
    },
    restartSearch: function () {
      restartAttempts += 1;
      return { success: true };
    }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.deepStrictEqual(result, { status: "LIVE_COMMENT_ENTRY_ENTERED" });
  assert.strictEqual(searchAttempts, 1);
  assert.strictEqual(restartAttempts, 1);
  assert.strictEqual(stages.filter(function (event) { return event.stage === "RETRYING_SEARCH"; }).length, 1);
}

function testFailsClearlyWhenSearchRetryStillHasNoResults() {
  var runtime = createRuntime({
    openSearch: function () { return { success: false, stage: "result_wait" }; },
    restartSearch: function () { return { success: false, stage: "result_wait" }; }
  });
  var stages = [];
  var result = runTask(runtime, { targetKeyword: "关键词" }, null, stages);

  assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
  assert.strictEqual(result.failedStage, "OPENING_SEARCH");
  assert.strictEqual(typeof result.message, "string");
  assert.strictEqual(stages.filter(function (event) { return event.stage === "RETRYING_SEARCH"; }).length, 1);
  assert.strictEqual(stages[stages.length - 1].stage, "FAILED");
}

function testDefaultRetryPrefersFastSearchOverDouyinFallback() {
  var fastSearchAttempts = 0;
  var douyinSearchAttempts = 0;
  var task = createLiveCommentEntryTask({
    context: {
      douyin: {
        openApp: function () { return true; },
        openSearch: function () { douyinSearchAttempts += 1; return true; },
        openLiveTab: function () { return true; },
        openFirstLive: function () { return true; },
        isLiveRoomVisible: function () { return true; }
      }
    },
    fastSearch: {
      openSearch: function () {
        fastSearchAttempts += 1;
        return fastSearchAttempts === 1
          ? { success: false, stage: "result_wait" }
          : { success: true };
      }
    }
  });

  assert.deepStrictEqual(task.run({ targetKeyword: "关键词" }), { status: "LIVE_COMMENT_ENTRY_ENTERED" });
  assert.strictEqual(fastSearchAttempts, 2);
  assert.strictEqual(douyinSearchAttempts, 0);
}

function testDefaultLiveTabFallbackTreatsFalseClickAsFailure() {
  var originalText = global.text;
  var originalClick = global.click;
  var originalSleep = global.sleep;
  global.text = function () {
    return { findOne: function () { return { click: function () { return false; } }; } };
  };
  global.click = function () { return false; };
  global.sleep = function () {};
  try {
    var task = createLiveCommentEntryTask({
      context: {
        douyin: {
          openApp: function () { return true; },
          isLiveRoomVisible: function () { return true; }
        }
      },
      fastSearch: { openSearch: function () { return true; } }
    });
    var result = task.run({ targetKeyword: "关键词" });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
    assert.strictEqual(result.failedStage, "OPENING_LIVE_TAB");
  } finally {
    global.text = originalText;
    global.click = originalClick;
    global.sleep = originalSleep;
  }
}

function testDefaultLiveTabFallbackIgnoresNodeBelowTopRegion() {
  var originalText = global.text;
  var originalClick = global.click;
  var originalSleep = global.sleep;
  var clickAttempts = 0;
  global.text = function () {
    var wrongNode = {
      bounds: function () {
        return { centerY: function () { return 1000; }, centerX: function () { return 300; } };
      },
      clickable: function () { return true; },
      click: function () { clickAttempts += 1; return true; }
    };
    return {
      find: function () { return [wrongNode]; },
      findOne: function () { return wrongNode; }
    };
  };
  global.click = function () { clickAttempts += 1; return true; };
  global.sleep = function () {};
  try {
    var task = createLiveCommentEntryTask({
      context: { douyin: { openApp: function () { return true; }, isLiveRoomVisible: function () { return true; } } },
      fastSearch: { openSearch: function () { return true; } }
    });
    var result = task.run({ targetKeyword: "关键词" });
    assert.strictEqual(result.status, "LIVE_COMMENT_ENTRY_FAILED");
    assert.strictEqual(result.failedStage, "OPENING_LIVE_TAB");
    assert.strictEqual(clickAttempts, 0);
  } finally {
    global.text = originalText;
    global.click = originalClick;
    global.sleep = originalSleep;
  }
}

testEntersLiveRoomThroughIndependentStateMachine();
testRetriesSearchOnlyOnceWhenFirstResultIsMissing();
testReportsFailureAfterOneRetry();
testDoesNotRetryWhenClickedResultIsNotConfirmedAsLiveRoom();
testClickFailureDoesNotRetrySearch();
testDefaultRuntimeReportsNoResultWhenFirstLiveProbeFindsNothing();
testStopsBeforeOpeningWhenControlRequestsStop();
testDefaultRuntimeUsesCurrentScreenSizeForFirstLiveCard();
testRetriesOnceWhenFastSearchHasNoResults();
testFailsClearlyWhenSearchRetryStillHasNoResults();
testDefaultRetryPrefersFastSearchOverDouyinFallback();
testDefaultLiveTabFallbackTreatsFalseClickAsFailure();
testDefaultLiveTabFallbackIgnoresNodeBelowTopRegion();
console.log("live comment entry tests passed");
