var assert = require("assert");
var fs = require("fs");
var path = require("path");
var createCommerceCardLiveRunner = require("../app/commerce-card-live-runner.js").createCommerceCardLiveRunner;

function createLogger(logs) {
  return {
    info: function (message, payload) {
      logs.push({ level: "INFO", message: message, payload: payload });
    },
    warn: function (message, payload) {
      logs.push({ level: "WARN", message: message, payload: payload });
    },
    error: function (message, payload) {
      logs.push({ level: "ERROR", message: message, payload: payload });
    }
  };
}

function createContext(overrides) {
  var logs = [];
  var checkpoints = [];
  var comments = [];
  var scans = [];
  var exits = 0;
  var context = {
    config: {
      task: {
        commerceCardLiveComment: {
          enabled: true,
          searchKeywords: ["夏橙"],
          matchKeywords: ["秭归", "夏橙"],
          liveSignals: ["直播中", "讲解中", "主播讲解", "进入直播间", "正在直播"],
          scanMinutesPerRound: 15,
          watchMinutesPerLive: 0,
          maxRounds: 3,
          maxCommentsPerRoom: 1,
          commentPool: ["111", "666", "👍", "🌹", "😊"]
        }
      },
      runtime: {
        riskWords: []
      }
    },
    logger: createLogger(logs),
    floatyControl: {
      state: {
        paused: false,
        stopRequested: false,
        exitRequested: false
      },
      update: function (patch) {
        for (var key in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, key)) {
            this.state[key] = patch[key];
          }
        }
      }
    },
    counters: {
      currentPhase: "",
      phaseStartedAt: "",
      phaseEndedAt: "",
      lastStopReason: "",
      liveRoomEnteredCount: 0,
      liveViewedCount: 0
    },
    controlLoop: {
      reportRuntimeLog: function (level, message, payload) {
        logs.push({ level: level, message: message, payload: payload });
      },
      waitWhilePaused: function () {},
      pollControlCommandsAsync: function () {}
    },
    heartbeatService: {
      writeHeartbeat: function () {}
    },
    taskScheduler: {
      recordCheckpoint: function (taskType, checkpoint) {
        checkpoints.push({ taskType: taskType, checkpoint: checkpoint });
      }
    },
    riskDetector: {
      containsRisk: function () {
        return false;
      }
    },
    douyin: {
      openMatchingCommerceLiveFromCards: function (options) {
        scans.push(options);
        return {
          success: true,
          reason: "commerce_live_entry_found",
          matchedKeywords: ["秭归", "夏橙"],
          textSample: "秭归夏橙 直播中"
        };
      },
      extractFastText: function () {
        return {
          combinedText: "秭归夏橙 正在直播 说点什么"
        };
      },
      sendLiveComment: function (comment) {
        comments.push(comment);
        return { success: true };
      },
      exitLiveRoom: function () {
        exits += 1;
      }
    },
    logs: logs,
    checkpoints: checkpoints,
    scans: scans,
    comments: comments,
    getExitCount: function () {
      return exits;
    }
  };
  overrides = overrides || {};
  for (var key in overrides) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      context[key] = overrides[key];
    }
  }
  return context;
}

function testCommerceCardLiveRunsThreeMatchedRounds() {
  var context = createContext();
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.reason, "commerce_card_live_rounds_finished");
  assert.strictEqual(result.completedRounds, 3);
  assert.strictEqual(context.scans.length, 3);
  assert.strictEqual(context.comments.length, 3);
  assert.strictEqual(context.getExitCount(), 3);
  assert.strictEqual(context.scans[0].searchKeyword, "夏橙");
  assert.deepStrictEqual(context.scans[0].matchKeywords, ["秭归", "夏橙"]);
  assert.strictEqual(context.scans[0].scanMinutes, 15);
}

function testCommerceCardLiveStopsGracefullyWhenNoMatchInRound() {
  var context = createContext();
  context.douyin.openMatchingCommerceLiveFromCards = function (options) {
    context.scans.push(options);
    return {
      success: false,
      reason: "commerce_live_not_found",
      matchedKeywords: [],
      textSample: "夏橙 商品卡 无直播"
    };
  };
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.reason, "commerce_live_not_found");
  assert.strictEqual(result.completedRounds, 0);
  assert.strictEqual(context.scans.length, 1);
  assert.strictEqual(context.comments.length, 0);
  assert.strictEqual(context.counters.lastStopReason, "commerce_live_not_found");
}

function testCommerceCardLivePauseStopsBeforeScanning() {
  var context = createContext();
  context.floatyControl.state.paused = true;
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, "manual_pause");
  assert.strictEqual(context.scans.length, 0);
  assert.strictEqual(context.comments.length, 0);
}

function testCollectorRoutesCommerceLiveBeforeOrdinaryLivePhase() {
  var source = fs.readFileSync(path.join(__dirname, "../app/collector-app.js"), "utf8");
  var commerceIndex = source.indexOf("commerceCardLiveRunner.runCommerceCardLiveCommentTask");
  var livePhaseIndex = source.indexOf("phaseRunner.runPhase(\"live\"");

  assert(commerceIndex >= 0, "collector app must call the commerce card live runner");
  assert(livePhaseIndex >= 0, "ordinary live phase must still exist");
  assert(commerceIndex < livePhaseIndex, "commerce card live route should be checked before ordinary live phase");
}

testCommerceCardLiveRunsThreeMatchedRounds();
testCommerceCardLiveStopsGracefullyWhenNoMatchInRound();
testCommerceCardLivePauseStopsBeforeScanning();
testCollectorRoutesCommerceLiveBeforeOrdinaryLivePhase();

console.log("commerce-card-live-runner tests passed");
