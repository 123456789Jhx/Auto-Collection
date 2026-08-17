var assert = require("assert");
var createLiveSessionRunner = require("../features/account-warmup/live-session-runner.js").createLiveSessionRunner;

function createHarness(options) {
  options = options || {};
  var time = 0;
  var live = options.live !== false;
  var interactions = 0;
  var switches = 0;
  var waits = [];
  var randomWaits = [];
  return {
    run: function (payload) {
      return createLiveSessionRunner({
        now: function () { return time; },
        wait: function (delayMs) { waits.push(delayMs); time += delayMs; },
        waitRandom: function (min, max) { randomWaits.push([min, max]); time += min; return min; },
        isLiveRoom: function () { return live; },
        nextLive: function () {
          switches += 1;
          if (options.nextLiveSucceeds === false) return false;
          live = true;
          return true;
        },
        interactionRunner: {
          run: function () {
            interactions += 1;
            time += Number(options.interactionDurationMs || 0);
            return { status: "COMPLETED", likes: { completed: 7 }, comments: { sentComments: ["好内容"] } };
          }
        }
      }).run(payload, { shouldStop: function () { return false; } });
    },
    setLive: function (value) { live = value; },
    state: function () { return { time: time, interactions: interactions, switches: switches, waits: waits, randomWaits: randomWaits }; }
  };
}

function testSingleLiveTimeoutWaitsForInteractionBeforeSwitching() {
  var harness = createHarness({ interactionDurationMs: 90000, nextLiveSucceeds: false });
  var result = harness.run({ singleLiveDurationMinutes: 1, totalWarmupDurationMinutes: 5 });
  assert.strictEqual(result.status, "NEXT_LIVE_FAILED");
  assert.strictEqual(harness.state().interactions, 1);
  assert.strictEqual(harness.state().switches, 1);
  assert.strictEqual(harness.state().time, 90000);
}

function testTotalTimeoutFinishesTheCurrentInteractionWithoutOpeningAnotherLive() {
  var harness = createHarness({ interactionDurationMs: 90000 });
  var result = harness.run({ singleLiveDurationMinutes: 10, totalWarmupDurationMinutes: 1 });
  assert.strictEqual(result.status, "COMPLETED");
  assert.strictEqual(result.reason, "TOTAL_DURATION_REACHED");
  assert.strictEqual(result.completedLiveCount, 1);
  assert.strictEqual(harness.state().switches, 0);
}

function testLiveEndWaitsRandomlyBeforeSwitching() {
  var harness = createHarness({ live: false, interactionDurationMs: 60000 });
  var result = harness.run({ singleLiveDurationMinutes: 5, totalWarmupDurationMinutes: 1 });
  assert.strictEqual(result.status, "COMPLETED");
  assert.strictEqual(harness.state().switches, 1);
  assert.deepStrictEqual(harness.state().randomWaits, [[2345, 5432]]);
  assert.strictEqual(harness.state().interactions, 1);
}

function testNormalSingleLiveDurationUsesOneSecondWatchTicksBeforeSwitching() {
  var harness = createHarness({ nextLiveSucceeds: false });
  var result = harness.run({ singleLiveDurationMinutes: 1, totalWarmupDurationMinutes: 5 });
  assert.strictEqual(result.status, "NEXT_LIVE_FAILED");
  assert.strictEqual(harness.state().waits.length, 60);
  assert.strictEqual(harness.state().waits.every(function (delayMs) { return delayMs === 1000; }), true);
}

function testValidatesEveryNewLiveBeforeInteraction() {
  var time = 0;
  var interactions = 0;
  var switches = 0;
  var validations = 0;
  var validationResults = [
    { matched: false, reason: "RELATED_TERM_NOT_MATCHED" },
    { matched: true, matchedTerm: "当归" }
  ];
  var result = createLiveSessionRunner({
    now: function () { return time; },
    wait: function (delayMs) { time += delayMs; },
    isLiveRoom: function () { return true; },
    nextLive: function () { switches += 1; return true; },
    interactionRunner: {
      run: function () {
        interactions += 1;
        time += 60000;
        return interactions === 1 ? { status: "COMPLETED" } : { status: "STOPPED" };
      }
    }
  }).run({ singleLiveDurationMinutes: 1, totalWarmupDurationMinutes: 5 }, {
    shouldStop: function () { return false; }
  }, {
    validateCurrentLive: function () {
      validations += 1;
      return validationResults.shift();
    }
  });

  assert.strictEqual(result.status, "STOPPED");
  assert.strictEqual(interactions, 2, "未命中的新直播间不能执行互动");
  assert.strictEqual(validations, 2, "每次切换到新直播间都必须重新校验");
  assert.strictEqual(switches, 2, "第一个直播间到时切换一次，未命中后继续切换一次");
}

function testTotalDurationStopsBeforeInteractingWithAJustValidatedLive() {
  var time = 0;
  var interactions = 0;
  var switches = 0;
  var result = createLiveSessionRunner({
    now: function () { return time; },
    wait: function (delayMs) { time += delayMs; },
    isLiveRoom: function () { return true; },
    nextLive: function () { switches += 1; return true; },
    interactionRunner: {
      run: function () {
        interactions += 1;
        time += 60000;
        return { status: "COMPLETED" };
      }
    }
  }).run({ singleLiveDurationMinutes: 1, totalWarmupDurationMinutes: 2 }, {
    shouldStop: function () { return false; }
  }, {
    validateCurrentLive: function () {
      time += 60000;
      return { matched: true, matchedTerm: "当归" };
    }
  });

  assert.strictEqual(result.status, "COMPLETED");
  assert.strictEqual(result.reason, "TOTAL_DURATION_REACHED");
  assert.strictEqual(interactions, 1, "总体时长到达后不能在新直播间开始互动");
  assert.strictEqual(switches, 1);
}

function testDismissesCalendarReminderBeforeCheckingLiveRoomDuringWatch() {
  var time = 0;
  var popupVisible = false;
  var dismissCalls = 0;
  var switches = 0;
  var result = createLiveSessionRunner({
    now: function () { return time; },
    wait: function (delayMs) { time += delayMs; },
    dismissTransientPopup: function () {
      dismissCalls += 1;
      if (!popupVisible) return false;
      popupVisible = false;
      return true;
    },
    isLiveRoom: function () { return !popupVisible; },
    nextLive: function () { switches += 1; return false; },
    interactionRunner: {
      run: function () {
        popupVisible = true;
        return { status: "COMPLETED" };
      }
    }
  }).run({ singleLiveDurationMinutes: 1, totalWarmupDurationMinutes: 1 }, {
    shouldStop: function () { return false; }
  });

  assert.strictEqual(result.status, "COMPLETED");
  assert.strictEqual(result.reason, "TOTAL_DURATION_REACHED");
  assert.strictEqual(switches, 0, "日历提醒弹窗不能被误判为直播下播");
  assert(dismissCalls >= 1, "观看计时期间必须持续检查临时弹窗");
}

testSingleLiveTimeoutWaitsForInteractionBeforeSwitching();
testTotalTimeoutFinishesTheCurrentInteractionWithoutOpeningAnotherLive();
testLiveEndWaitsRandomlyBeforeSwitching();
testNormalSingleLiveDurationUsesOneSecondWatchTicksBeforeSwitching();
testValidatesEveryNewLiveBeforeInteraction();
testTotalDurationStopsBeforeInteractingWithAJustValidatedLive();
testDismissesCalendarReminderBeforeCheckingLiveRoomDuringWatch();
console.log("account warmup live session runner tests passed");
