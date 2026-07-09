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

function withFakeClock(callback) {
  var realDateNow = Date.now;
  var realSleep = global.sleep;
  var fakeNow = new Date("2026-07-09T00:00:00.000Z").getTime();
  var sleeps = [];
  Date.now = function () {
    return fakeNow;
  };
  global.sleep = function (ms) {
    var duration = Math.max(0, Number(ms) || 0);
    sleeps.push(duration);
    fakeNow += duration;
  };
  try {
    return callback(sleeps);
  } finally {
    Date.now = realDateNow;
    if (realSleep === undefined) {
      delete global.sleep;
    } else {
      global.sleep = realSleep;
    }
  }
}

function sum(values) {
  var total = 0;
  for (var i = 0; i < values.length; i++) {
    total += Number(values[i] || 0);
  }
  return total;
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
          executeEnabled: true,
          manualExecutionApproved: true,
          searchKeywords: ["夏橙"],
          matchKeywords: ["秭归", "夏橙"],
          liveSignals: ["直播中", "讲解中", "主播讲解", "进入直播间", "正在直播"],
          scanMinutesPerRound: 15,
          watchMinutesPerLive: 15,
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
    storage: {
      liveCommentLogs: [],
      appendLiveCommentLog: function (entry) {
        this.liveCommentLogs.push(entry);
      }
    },
    uploader: {
      liveCommentActions: [],
      uploadLiveCommentAction: function (entry) {
        this.liveCommentActions.push(entry);
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
          textSample: "秭归夏橙 直播中 第" + scans.length + "轮"
        };
      },
      extractFastText: function () {
        return {
          combinedText: "秭归夏橙 正在直播 说点什么 第" + scans.length + "轮"
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
  withFakeClock(function (sleeps) {
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
    assert.strictEqual(sum(sleeps), 3 * 15 * 60 * 1000);
    assert.strictEqual(context.storage.liveCommentLogs.length, 3);
    assert.strictEqual(context.uploader.liveCommentActions.length, 3);
    assert.strictEqual(context.storage.liveCommentLogs[0].status, "sent");
  });
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

function testCommerceCardLiveStopsAfterLaterNoMatchWithoutThirdRound() {
  withFakeClock(function (sleeps) {
    var context = createContext();
    context.douyin.openMatchingCommerceLiveFromCards = function (options) {
      context.scans.push(options);
      if (context.scans.length === 1) {
        return {
          success: true,
          reason: "commerce_live_entry_found",
          matchedKeywords: ["秭归", "夏橙"],
          textSample: "秭归夏橙 正在直播 第一轮"
        };
      }
      return {
        success: false,
        reason: "commerce_live_not_found",
        matchedKeywords: [],
        textSample: "夏橙 商品卡 第二轮无直播"
      };
    };
    var runner = createCommerceCardLiveRunner(context);

    var result = runner.runCommerceCardLiveCommentTask();

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reason, "commerce_live_not_found");
    assert.strictEqual(result.completedRounds, 1);
    assert.strictEqual(context.scans.length, 2);
    assert.strictEqual(context.comments.length, 1);
    assert.strictEqual(context.getExitCount(), 1);
    assert.strictEqual(sum(sleeps), 15 * 60 * 1000);
  });
}

function testCommerceCardLiveUsesLiveTargetsBeforeLegacyCommerceConfig() {
  withFakeClock(function (sleeps) {
    var context = createContext();
    context.config.task.commerceCardLiveComment = {
      enabled: false
    };
    context.config.task.liveTargets = [
      {
        targetCode: "zigui_xiacheng",
        targetName: "秭归夏橙直播间",
        featureType: "commerce_card_live_comment",
        searchKeywords: ["夏橙商品"],
        productKeywords: ["秭归", "夏橙"],
        liveSignals: ["直播中"],
        similarityThreshold: 0.9,
        aliases: [
          { aliasText: "秭归夏橙", aliasType: "room_name", weight: 100 }
        ],
        runtimeConfig: {
          scanMinutesPerRound: 15,
          watchMinutesPerLive: 15,
          maxRounds: 1,
          maxCommentsPerRoom: 1,
          commentPool: ["111"]
        },
        enabled: true
      }
    ];
    var passedOptions = null;
    context.douyin.openMatchingCommerceLiveFromCards = function (options) {
      context.scans.push(options);
      passedOptions = options;
      return {
        success: true,
        reason: "commerce_live_entry_found",
        matchedKeywords: ["秭归", "夏橙"],
        textSample: "秭归夏橙 直播中"
      };
    };
    var runner = createCommerceCardLiveRunner(context);

    var result = runner.runCommerceCardLiveCommentTask();

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.completedRounds, 1);
    assert.strictEqual(passedOptions.searchKeyword, "夏橙商品");
    assert.deepStrictEqual(passedOptions.matchKeywords, ["秭归", "夏橙"]);
    assert.deepStrictEqual(passedOptions.liveSignals, ["直播中"]);
    assert.strictEqual(passedOptions.targetRoom.targetName, "秭归夏橙直播间");
    assert.strictEqual(sum(sleeps), 15 * 60 * 1000);
  });
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

function testCommerceCardLiveIsDisabledByDefault() {
  var context = createContext();
  context.config.task.commerceCardLiveComment = undefined;
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, "commerce_card_live_disabled");
  assert.strictEqual(context.scans.length, 0);
  assert.strictEqual(context.comments.length, 0);
}

function testCommerceCardLiveRequiresExplicitSendApproval() {
  withFakeClock(function () {
    var context = createContext();
    context.config.task.commerceCardLiveComment.executeEnabled = false;
    context.config.task.commerceCardLiveComment.manualExecutionApproved = false;
    var runner = createCommerceCardLiveRunner(context);

    var result = runner.runCommerceCardLiveCommentTask({ maxRounds: 1 });

    assert.strictEqual(result.success, true);
    assert.strictEqual(context.scans.length, 1);
    assert.strictEqual(context.comments.length, 0);
    assert.strictEqual(context.storage.liveCommentLogs.length, 1);
    assert.strictEqual(context.storage.liveCommentLogs[0].status, "skipped");
    assert.strictEqual(context.storage.liveCommentLogs[0].skipReason, "commerce_card_send_not_approved");
  });
}

function testCollectorKeepsCommerceLiveSeparateFromOrdinaryLivePhase() {
  var source = fs.readFileSync(path.join(__dirname, "../app/collector-app.js"), "utf8");
  var runLiveStart = source.indexOf("function runLiveTask");
  var runVideoStart = source.indexOf("function runVideoTask", runLiveStart);
  var runOneStart = source.indexOf("function runOneTask");
  var finishStart = source.indexOf("function finishTask", runOneStart);
  var runLiveBlock = source.slice(runLiveStart, runVideoStart);
  var runOneBlock = source.slice(runOneStart, finishStart);
  var commerceBranchIndex = runOneBlock.indexOf("requestedTaskType === \"commerce_card_live_comment\"");
  var liveBranchIndex = runOneBlock.indexOf("requestedTaskType === \"live\"");

  assert(runLiveBlock.indexOf("phaseRunner.runPhase(\"live\"") >= 0, "ordinary live phase must still exist");
  assert.strictEqual(runLiveBlock.indexOf("commerceCardLiveRunner.runCommerceCardLiveCommentTask"), -1, "ordinary live task must not run the commerce card live runner");
  assert(commerceBranchIndex >= 0, "collector app must have an independent commerce-card live comment branch");
  assert(liveBranchIndex >= 0, "collector app must still have an ordinary live branch");
  assert(commerceBranchIndex < liveBranchIndex, "commerce-card live comment branch should be handled before ordinary live");
}

testCommerceCardLiveRunsThreeMatchedRounds();
testCommerceCardLiveStopsGracefullyWhenNoMatchInRound();
testCommerceCardLiveStopsAfterLaterNoMatchWithoutThirdRound();
testCommerceCardLiveUsesLiveTargetsBeforeLegacyCommerceConfig();
testCommerceCardLivePauseStopsBeforeScanning();
testCommerceCardLiveIsDisabledByDefault();
testCommerceCardLiveRequiresExplicitSendApproval();
testCollectorKeepsCommerceLiveSeparateFromOrdinaryLivePhase();

console.log("commerce-card-live-runner tests passed");
