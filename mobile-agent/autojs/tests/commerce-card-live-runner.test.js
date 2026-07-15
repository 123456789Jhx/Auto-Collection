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

function createV2Context(options) {
  options = options || {};
  var context = createContext();
  var checkpoint = null;
  var stateVersion = 3;
  var lastEventSeq = 2;
  var action = null;
  var completedAssignments = [];
  var commentUpdates = [];
  var accountReadCount = 0;
  var liveFeedSearchCalls = [];
  var liveFeedRefreshes = [];
  var workflow = {
    assignmentId: "assignment-v2",
    workflowVersion: 2,
    selectedTarget: {
      targetId: "target-v2",
      targetCode: "target-code",
      targetName: "target room",
      searchKeywords: ["target room"],
      productKeywords: ["product"],
      liveSignals: ["live"],
      requiredKeywords: [],
      forbiddenKeywords: [],
      aliases: [],
      similarityThreshold: 0.9,
      enabled: true
    },
    expectedAccount: {
      accountId: "name:test account",
      accountName: "Test Account"
    },
    configRevision: 1,
    configHash: new Array(65).join("a"),
    snapshotHash: new Array(65).join("b"),
    executionApprovalId: "approval-v2",
    expiresAt: "2027-07-09T00:00:00.000Z",
    state: "RUNNING",
    stateVersion: stateVersion,
    lastEventSeq: lastEventSeq,
    configSnapshot: {
      runtimeConfig: {
        enabledStages: ["target_comment"],
        recommendationSignals: ["recommended"],
        productCardDwellSeconds: 120,
        productNurtureRoundMinutes: 15,
        productNurtureMaxRounds: 1,
        targetLiveMaxRoomsPerRefresh: 25,
        targetCommentSearchMaxActiveMinutes: 60,
        maxCommentsPerRoom: 1,
        commentPool: ["hello"],
        liveNurtureKeywords: [],
        liveNurtureRefreshAfterRooms: 10,
        liveNurtureWatchMinMinutes: 10,
        liveNurtureWatchMaxMinutes: 20,
        liveNurtureTotalMinMinutes: 70,
        liveNurtureTotalMaxMinutes: 100,
        taskMaxActiveMinutes: 240
      }
    }
  };
  if (options.enabledStages) {
    workflow.configSnapshot.runtimeConfig.enabledStages = options.enabledStages.slice();
  }
  if (options.runtimeConfig) {
    for (var runtimeKey in options.runtimeConfig) {
      if (Object.prototype.hasOwnProperty.call(options.runtimeConfig, runtimeKey)) {
        workflow.configSnapshot.runtimeConfig[runtimeKey] = options.runtimeConfig[runtimeKey];
      }
    }
  }
  context.config.device = { deviceId: "device-v2" };
  context.config.task.taskId = "task-v2";
  context.config.task.effectiveWorkflow = workflow;
  context.taskScheduler = {
    getAssignmentContext: function () {
      return {
        assignmentId: workflow.assignmentId,
        stateVersion: stateVersion,
        lastEventSeq: lastEventSeq,
        checkpoint: checkpoint ? JSON.parse(JSON.stringify(checkpoint)) : null
      };
    },
    getTaskState: function () {
      return { status: workflow.state };
    },
    recordCheckpoint: function (_taskType, value) {
      checkpoint = JSON.parse(JSON.stringify(value));
      context.checkpoints.push({ taskType: "commerce_card_live_comment", checkpoint: checkpoint });
      if (options.onCheckpoint) {
        options.onCheckpoint(checkpoint, context);
      }
      return JSON.parse(JSON.stringify(checkpoint));
    },
    updateAssignmentRuntime: function (_taskType, state, nextStateVersion, nextEventSeq) {
      workflow.state = state || workflow.state;
      stateVersion = Number(nextStateVersion || stateVersion);
      lastEventSeq = Math.max(lastEventSeq, Number(nextEventSeq || 0));
    }
  };
  context.uploader = {
    liveCommentActions: [],
    sha256Hex: function () { return new Array(65).join("c"); },
    canonicalSha256: function () { return new Array(65).join("d"); },
    uploadLiveCommentAction: function (entry) {
      this.liveCommentActions.push(entry);
    },
    reportAssignmentEvent: function () {
      lastEventSeq += 1;
      stateVersion += 1;
      return {
        success: true,
        data: {
          assignment: {
            state: workflow.state,
            stateVersion: stateVersion,
            lastEventSeq: lastEventSeq
          }
        }
      };
    },
    updateAssignmentProgress: function () {
      return {
        success: true,
        data: {
          assignment: {
            state: workflow.state,
            stateVersion: stateVersion,
            lastEventSeq: lastEventSeq
          }
        }
      };
    },
    completeAssignment: function (_assignmentId, payload) {
      completedAssignments.push(payload);
      workflow.state = payload.state;
      stateVersion += 1;
      lastEventSeq += 1;
      return {
        success: true,
        data: {
          assignment: {
            state: workflow.state,
            stateVersion: stateVersion,
            lastEventSeq: lastEventSeq
          }
        }
      };
    },
    reserveCommerceCardCommentAction: function () {
      action = options.reserveAction || {
        id: "action-v2",
        roomKey: "target:target-code",
        commentSlot: 0,
        commentHash: new Array(65).join("c"),
        actionState: "planned",
        stateVersion: 1
      };
      return {
        success: true,
        data: {
          action: action,
          permitToken: options.permitToken === undefined ? new Array(40).join("p") : options.permitToken,
          permitExpiresAt: options.permitExpiresAt || "2027-07-09T00:00:00.000Z",
          assignment: {
            state: workflow.state,
            stateVersion: stateVersion,
            lastEventSeq: lastEventSeq
          }
        }
      };
    },
    updateCommerceCardCommentAction: function (_assignmentId, _actionId, payload) {
      commentUpdates.push(payload.state);
      action = {
        id: action.id,
        roomKey: action.roomKey,
        commentSlot: action.commentSlot,
        commentHash: action.commentHash,
        actionState: payload.state,
        stateVersion: Number(action.stateVersion || 0) + 1,
        failureReason: payload.failureReason || ""
      };
      stateVersion += 1;
      lastEventSeq += 1;
      if (payload.state === "unknown") {
        workflow.state = "BLOCKED";
      }
      return {
        success: true,
        data: {
          action: action,
          assignment: {
            state: workflow.state,
            stateVersion: stateVersion,
            lastEventSeq: lastEventSeq
          }
        }
      };
    },
    getCommerceCardCommentActionByKey: function () {
      return { success: true, data: action };
    }
  };
  context.douyin.openTargetLiveRoomFromLiveFeed = function (gateOptions) {
    liveFeedSearchCalls.push(gateOptions);
    if (Array.isArray(options.targetGateResults) && options.targetGateResults.length) {
      return options.targetGateResults.shift() === true;
    }
    if (options.targetGateResult !== undefined) {
      return options.targetGateResult === true;
    }
    return true;
  };
  context.douyin.openTargetLiveRoomFromSearch = function () {
    throw new Error("V2 target comment must use live feed gate");
  };
  context.douyin.getLastTargetLiveSearchResult = function () {
    return { reason: "room_verified", roomKey: "target:target-code", roomName: "target room", anchorName: "anchor" };
  };
  context.douyin.refreshLiveFeedFromHome = function (refreshOptions) {
    liveFeedRefreshes.push(refreshOptions || {});
    return true;
  };
  context.douyin.readCurrentAccountName = function () {
    accountReadCount += 1;
    var accountName = options.accountNames && options.accountNames[accountReadCount - 1] || "Test Account";
    return { success: true, accountName: accountName };
  };
  context.douyin.isLiveRoomVisible = function () {
    return options.liveRoomVisible !== false;
  };
  context.douyin.sendLiveComment = function (comment) {
    context.comments.push(comment);
    return { success: true };
  };
  context._v2 = {
    getCheckpoint: function () { return checkpoint; },
    getAction: function () { return action; },
    completedAssignments: completedAssignments,
    commentUpdates: commentUpdates,
    liveFeedSearchCalls: liveFeedSearchCalls,
    liveFeedRefreshes: liveFeedRefreshes
  };
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

function testCommerceCardLiveBrowsesProductCardsBeforeTargetLiveSearch() {
  var context = createContext();
  var callOrder = [];
  context.config.task.commerceCardLiveComment.maxRounds = 1;
  context.config.task.commerceCardLiveComment.watchMinutesPerLive = 0;
  context.config.task.commerceCardLiveComment.searchKeywords = ["orange"];
  context.config.task.commerceCardLiveComment.matchKeywords = ["orange", "product"];
  context.config.task.commerceCardLiveComment.targetRoom = {
    enabled: true,
    targetName: "target-room",
    searchKeywords: ["target-live-keyword"],
    matchKeywords: ["target-room"]
  };
  context.douyin.browseCommerceCards = function (options) {
    callOrder.push({ type: "browse_cards", options: options });
    return { success: true, reason: "commerce_cards_browsed", browsedCount: 4 };
  };
  context.douyin.openTargetLiveRoomFromSearch = function (options) {
    callOrder.push({ type: "target_live_search", options: options });
    return true;
  };
  context.douyin.getLastTargetLiveSearchResult = function () {
    return {
      reason: "room_verified",
      roomName: "target-room",
      matchedKeywords: ["target-room"],
      textSample: "target-room live"
    };
  };
  context.douyin.openMatchingCommerceLiveFromCards = function (options) {
    callOrder.push({ type: "legacy_matching", options: options });
    return { success: true, reason: "commerce_live_entry_found", matchedKeywords: ["orange"], textSample: "legacy live" };
  };
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(callOrder.map(function (entry) { return entry.type; }), ["browse_cards", "target_live_search"]);
  assert.strictEqual(callOrder[0].options.searchKeyword, "orange");
  assert.strictEqual(callOrder[0].options.cardCount, 4);
  assert.strictEqual(callOrder[1].options.keyword, "target-live-keyword");
  assert.strictEqual(callOrder[1].options.targetRoom.targetName, "target-room");
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

function testDouyinProvidesDedicatedCommerceCardBrowseAdapter() {
  var source = fs.readFileSync(path.join(__dirname, "../platforms/douyin.js"), "utf8");
  var commerceCardDetectorSource = fs.readFileSync(path.join(__dirname, "../domain/commerce-card/candidate-detector.js"), "utf8");
  var commerceCardSource = source + "\n" + commerceCardDetectorSource;
  var start = source.indexOf("function browseCommerceCards(options)");
  var end = source.indexOf("function setTargetLiveSearchResult", start);
  var body = source.slice(start, end);

  assert(start >= 0 && end > start, "douyin adapter must expose a product-card browsing phase");
  assert(body.indexOf("openCommerceCardSearch(searchKeyword)") >= 0, "browse phase must start from mall product-card search");
  assert(body.indexOf("clickCommerceKeywordCard(matchKeywords)") >= 0, "browse phase must open matching product cards");
  assert(body.indexOf("clickCommerceRelatedProductCard(matchKeywords, skippedRelatedBounds)") >= 0, "detail browse must continue through related product cards without relying on a heading");
  assert(source.indexOf("findCommerceRelatedProductCardCandidate(node, keywordRegex, skippedBounds, screen)") >= 0, "related product clicks must promote keyword nodes to their product-card container");
  assert(source.indexOf("findCommerceKeywordProductCardCandidate(node, keywordRegex, screen)") >= 0, "search-result product clicks must promote keyword nodes to their product-card container");
  assert(source.indexOf("isCommerceRelatedCardBoundsAllowed(bounds, screen)") >= 0, "related product clicks must reject oversized detail containers and tiny keyword fragments");
  assert(commerceCardSource.indexOf("isRelatedZoneText(detailText)") >= 0 || commerceCardSource.indexOf("isCommerceRelatedZoneText(detailText)") >= 0, "detail browse must recognize built-in related-product headings such as 你可能想看");
  assert(commerceCardSource.indexOf("isProductTitleLikeText(combinedText)") >= 0 || commerceCardSource.indexOf("isCommerceProductTitleLikeText(combinedText)") >= 0, "related product clicks must allow title-like product cards when the related zone is visible");
  assert(body.indexOf("buildCommerceDetailSignature(detailText)") >= 0, "detail browse must snapshot the current product detail before clicking a related card");
  assert(body.indexOf("afterRelatedSignature !== beforeRelatedSignature") >= 0, "detail browse must verify that a related-card click opened a different product before counting it");
  assert(body.indexOf("skippedRelatedBounds[relatedClick.bounds] = true") >= 0, "detail browse must skip a related-card bounds when clicking it does not navigate");
  assert(body.indexOf("hasCommerceRelatedProductList(detailText, matchKeywords, targetRoom, recommendationSignals)") >= 0, "detail browse must recognize product-card lists even when the related-products heading is absent");
  assert(body.indexOf("hasCommerceRelatedProductList(detailText, matchKeywords, targetRoom, recommendationSignals)") < body.indexOf("swipeSearchResultsUp();"), "detail browse must try related product cards before continuing to swipe or returning to search results");
  assert.strictEqual(body.indexOf("recommendedClicks < 2"), -1, "detail browse must not stop after only two related product cards");
  assert(body.indexOf("browseOpenedCommerceDetail(attempt, endAt, remainingCards, requireFullScan)") >= 0, "full-scan product nurture must stay in the opened product detail chain");
  assert(body.indexOf("var openedDetailThisAttempt = false") >= 0, "browse phase must track whether the current loop already opened a product detail");
  assert(body.indexOf("!openedDetailThisAttempt && (requireFullScan || browsedCount < cardCount)") >= 0, "browse phase must not swipe the search-result page after opening a product detail");
  assert(source.indexOf("textMatches(\"^(商品|店铺)$\")") < 0, "commerce search must not switch to the 店铺 tab when 商品 is unavailable");
  assert(source.indexOf("textMatches(\"^商品$\")") < 0, "commerce search must not leave 全部/综合 by switching to 商品 tab");
  assert(source.indexOf("descMatches(\"^商品$\")") < 0, "commerce search must not leave 全部/综合 by switching to 商品 desc tab");
  assert(source.indexOf("textMatches(\"^全部$\")") >= 0, "commerce search should use the 全部 product-card result flow");
  assert(source.indexOf("textMatches(\"^综合$\")") < 0, "commerce search must not switch to 综合 for product-card nurture");
  assert(source.indexOf("isCommerceProductCandidateNode(node)") >= 0, "commerce card clicks must verify product-card signals before clicking keyword nodes");
  assert(commerceCardSource.indexOf("相关搜索|大家都在搜|最近看过|评论") >= 0, "commerce card clicks must reject related-search, video, and comment nodes");
  assert(commerceCardSource.indexOf("¥|￥|券后价|到手价|已售") >= 0, "commerce card clicks must require commodity signals such as price or sales text");
  assert(body.indexOf("options.skipLiveCards === true") >= 0, "browse phase must support ignoring live cards during product-card nurture");
  assert(body.indexOf("!skipLiveCards && !openedLive") >= 0, "product-card browsing must not enter live cards when skipLiveCards is enabled");
  assert(body.indexOf("liveWatchSeconds") >= 0, "commerce live card watch duration must be configurable");
  assert(body.indexOf("recoverCommerceCardSearch(searchKeyword") >= 0, "browse phase must recover when it leaves mall commerce context");
  assert(body.indexOf("options.pollControlCommands") >= 0, "browse phase must poll backend control commands during long waits");
  assert(source.indexOf("销量|筛选|回头客|产地直供|好评多|直播") >= 0, "commerce result tabs like 综合/销量/直播/筛选 must be treated as valid commerce context");
  assert(source.indexOf("isCommerceSearchOrDetailText(textValueString)") >= 0, "valid commerce pages must not be treated as video drift");
  assert(source.indexOf("tryReuseCommerceCardSearchResult(keyword, \"before_enter_mall\")") >= 0, "commerce search should reuse a restored target search result before looking for mall entry");
  assert(source.indexOf("tryReuseCommerceCardSearchResult(keyword, \"after_enter_mall_failed\")") >= 0, "commerce search should reuse current target result when mall entry is unavailable");
  assert(source.indexOf("isSearchResultPageText(textSample) && clickCommerceResultTabIfVisible()") >= 0, "commerce context recovery should reuse the current search result page before reopening mall");
  assert.strictEqual(body.indexOf("sleepInterruptible(1800"), -1, "commerce live cards must not be a fixed short flash-open");
  assert.strictEqual(body.indexOf("openTargetLiveRoomFromSearch"), -1, "target live room search must stay outside the card browsing phase");
  assert(source.indexOf("browseCommerceCards: browseCommerceCards") >= 0, "douyin adapter must export browseCommerceCards");
}

function testMobileLogsPreferVisibleStorage() {
  var mainSource = fs.readFileSync(path.join(__dirname, "../main.module.js"), "utf8");
  var watchdogSource = fs.readFileSync(path.join(__dirname, "../watchdog.js"), "utf8");

  assert(mainSource.indexOf("/storage/emulated/0/燎原星火") >= 0, "main script should prefer visible internal storage for logs");
  assert(mainSource.indexOf("ensureWritableDir(visibleBaseDir)") >= 0, "main script should verify visible log storage before using it");
  assert(watchdogSource.indexOf("/storage/emulated/0/燎原星火") >= 0, "watchdog should use the same visible log storage resolver");
  assert(watchdogSource.indexOf("ensureWritableDir(visibleBaseDir)") >= 0, "watchdog should verify visible log storage before using it");
}

function testV2ProductNurtureUsesLiveFeedGateAndReusesRoom() {
  var context = createV2Context({
    enabledStages: ["product_nurture", "target_comment"]
  });
  var browseCalls = [];
  context.douyin.browseCommerceCards = function (options) {
    browseCalls.push(options);
    return {
      success: true,
      reason: "commerce_cards_browsed",
      browsedCount: 8,
      textSample: "product recommended"
    };
  };
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, true);
  assert.strictEqual(context.comments.length, 1);
  assert.strictEqual(browseCalls.length, 1);
  assert.strictEqual(browseCalls[0].dwellSeconds, 120);
  assert.strictEqual(browseCalls[0].liveWatchSeconds, 120);
  assert.strictEqual(browseCalls[0].requireFullScan, true);
  assert.strictEqual(browseCalls[0].skipLiveCards, true);
  assert.deepStrictEqual(browseCalls[0].recommendationSignals, ["recommended"]);
  assert.strictEqual(context._v2.liveFeedSearchCalls.length, 1);
  assert.strictEqual(context._v2.liveFeedSearchCalls[0].source, "product_nurture");
  assert.strictEqual(context._v2.liveFeedSearchCalls[0].restartBeforeScan, true);
  assert(context._v2.liveFeedSearchCalls[0].maxCandidates >= 20);
  assert(context._v2.liveFeedSearchCalls[0].maxCandidates <= 30);
  assert.strictEqual(typeof context._v2.liveFeedSearchCalls[0].pollControlCommands, "function");
  assert.strictEqual(context._v2.completedAssignments[0].state, "SUCCEEDED");
}

function testV2ProductNurtureOnlyDoesNotSendComment() {
  var context = createV2Context({
    enabledStages: ["product_nurture"]
  });
  var browseCalls = [];
  context.douyin.browseCommerceCards = function (options) {
    browseCalls.push(options);
    return {
      success: true,
      reason: "commerce_cards_browsed",
      browsedCount: 6,
      textSample: "product recommended"
    };
  };
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, true);
  assert.strictEqual(context.comments.length, 0);
  assert.strictEqual(browseCalls.length, 1);
  assert.strictEqual(browseCalls[0].skipLiveCards, true);
  assert.strictEqual(context._v2.liveFeedSearchCalls.length, 1);
  assert.strictEqual(context._v2.liveFeedSearchCalls[0].source, "product_nurture");
  assert(context._v2.liveFeedSearchCalls[0].maxCandidates >= 20);
  assert(context._v2.liveFeedSearchCalls[0].maxCandidates <= 30);
  assert.strictEqual(context.getExitCount(), 1);
  assert.strictEqual(context._v2.completedAssignments[0].state, "SUCCEEDED");
}

function testV2ProductNurtureFailsWhenTargetNotFoundAfterRounds() {
  var context = createV2Context({
    enabledStages: ["product_nurture"],
    targetGateResults: [false, false],
    runtimeConfig: {
      productNurtureMaxRounds: 2
    }
  });
  var browseCount = 0;
  context.douyin.browseCommerceCards = function () {
    browseCount += 1;
    return {
      success: true,
      reason: "commerce_cards_browsed",
      browsedCount: 4,
      textSample: "product only"
    };
  };
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, "product_target_not_found");
  assert.strictEqual(browseCount, 2);
  assert.strictEqual(context.comments.length, 0);
  assert.strictEqual(context._v2.liveFeedSearchCalls.length, 2);
  assert.strictEqual(context._v2.completedAssignments[0].state, "FAILED");
}

function testV2TargetCommentMissRefreshesAndFailsClosed() {
  var context = createV2Context({
    targetGateResults: [false, false],
    runtimeConfig: {
      targetCommentSearchMaxActiveMinutes: 3
    }
  });
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, "target_live_room_not_found");
  assert.strictEqual(context.comments.length, 0);
  assert.strictEqual(context._v2.liveFeedSearchCalls.length, 2);
  assert.strictEqual(context._v2.liveFeedRefreshes.length, 1);
  assert.strictEqual(context._v2.completedAssignments[0].state, "FAILED");
}

function testV2StopBeforeSendFailsClosed() {
  var context = createV2Context({
    onCheckpoint: function (checkpoint, currentContext) {
      if (checkpoint.pendingSideEffect && checkpoint.pendingSideEffect.lastConfirmedState === "submitting") {
        currentContext.floatyControl.state.stopRequested = true;
      }
    }
  });
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.cancelled, true);
  assert.strictEqual(context.comments.length, 0);
  assert(context._v2.commentUpdates.indexOf("failed") >= 0);
  assert.strictEqual(context._v2.getCheckpoint().pendingSideEffect, null);
}

function testV2ExpiredPermitDoesNotSend() {
  var context = createV2Context({
    permitExpiresAt: "2020-01-01T00:00:00.000Z"
  });
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, false);
  assert.strictEqual(context.comments.length, 0);
  assert(context._v2.commentUpdates.indexOf("failed") >= 0);
  assert.strictEqual(context._v2.completedAssignments[0].state, "FAILED");
}

function testV2AccountChangeDoesNotSend() {
  var context = createV2Context({
    accountNames: ["Test Account", "Other Account"]
  });
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, false);
  assert.strictEqual(context.comments.length, 0);
  assert(context._v2.commentUpdates.indexOf("failed") >= 0);
}

function testV2MissingLivePageDoesNotSend() {
  var context = createV2Context({ liveRoomVisible: false });
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, false);
  assert.strictEqual(context.comments.length, 0);
  assert(context._v2.commentUpdates.indexOf("failed") >= 0);
}

function testV2SubmittingActionBecomesUnknownWithoutResend() {
  var context = createV2Context({
    reserveAction: {
      id: "action-v2",
      roomKey: "target:target-code",
      commentSlot: 0,
      commentHash: new Array(65).join("c"),
      actionState: "submitting",
      stateVersion: 2
    }
  });
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.blocked, true);
  assert.strictEqual(context.comments.length, 0);
  assert(context._v2.commentUpdates.indexOf("unknown") >= 0);
  assert.strictEqual(context._v2.getAction().actionState, "unknown");
}

function testV2LiveNurtureCompletesOnlyAfterPlannedWatch() {
  withFakeClock(function (sleeps) {
    var context = createV2Context({
      enabledStages: ["live_nurture"],
      runtimeConfig: {
        liveNurtureKeywords: ["orange"],
        liveNurtureWatchMinMinutes: 1,
        liveNurtureWatchMaxMinutes: 1,
        liveNurtureTotalMinMinutes: 1,
        liveNurtureTotalMaxMinutes: 1
      }
    });
    var enterFeedCount = 0;
    var openRoomCount = 0;
    context.douyin.enterLiveFeed = function () {
      enterFeedCount += 1;
      return true;
    };
    context.douyin.extractFastText = function () {
      return { combinedText: "orange live room title" };
    };
    context.douyin.openLiveRoomFromCurrentScreen = function () {
      openRoomCount += 1;
      return true;
    };
    var runner = createCommerceCardLiveRunner(context);

    var result = runner.runCommerceCardLiveCommentTask();

    assert.strictEqual(result.success, true);
    assert.strictEqual(enterFeedCount, 1);
    assert.strictEqual(openRoomCount, 1);
    assert.strictEqual(sum(sleeps), 60 * 1000);
    assert.strictEqual(context._v2.getCheckpoint().plannedWatchMs, 60 * 1000);
    assert.strictEqual(context._v2.getCheckpoint().completedWatchMs, 60 * 1000);
    assert.strictEqual(context._v2.completedAssignments[0].state, "SUCCEEDED");
  });
}

function testV2LiveNurtureFailsWhenWatchTargetNotReached() {
  var context = createV2Context({
    enabledStages: ["live_nurture"],
    runtimeConfig: {
      liveNurtureKeywords: ["orange"],
      liveNurtureRefreshAfterRooms: 10,
      liveNurtureWatchMinMinutes: 1,
      liveNurtureWatchMaxMinutes: 1,
      liveNurtureTotalMinMinutes: 1,
      liveNurtureTotalMaxMinutes: 1
    }
  });
  var nextCount = 0;
  context.douyin.enterLiveFeed = function () {
    return true;
  };
  context.douyin.extractFastText = function () {
    return { combinedText: "plain live room title" };
  };
  context.douyin.openLiveRoomFromCurrentScreen = function () {
    throw new Error("unmatched live room must not be opened");
  };
  context.douyin.nextVideo = function () {
    nextCount += 1;
    return true;
  };
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, "live_nurture_watch_incomplete");
  assert.strictEqual(context._v2.getCheckpoint().completedWatchMs, 0);
  assert.strictEqual(context._v2.liveFeedRefreshes.length, 10);
  assert.strictEqual(nextCount, 90);
  assert.strictEqual(context._v2.completedAssignments[0].state, "FAILED");
}

function testV2CheckpointRemainsStructuredAfterCompletion() {
  var context = createV2Context();
  var runner = createCommerceCardLiveRunner(context);

  var result = runner.runCommerceCardLiveCommentTask();

  assert.strictEqual(result.success, true);
  assert.strictEqual(context.comments.length, 1);
  assert.strictEqual(context._v2.getCheckpoint().checkpointVersion, 2);
  assert.strictEqual(context._v2.getCheckpoint().assignmentId, "assignment-v2");
}

function testCollectorPreservesV2CheckpointAndCompletesDeferredControl() {
  var source = fs.readFileSync(path.join(__dirname, "../app/collector-app.js"), "utf8");
  var runCommerceStart = source.indexOf("function runCommerceCardLiveCommentTask");
  var runLiveStart = source.indexOf("function runLiveTask", runCommerceStart);
  var runCommerceBlock = source.slice(runCommerceStart, runLiveStart);

  assert(runCommerceBlock.indexOf("Number(workflow.workflowVersion || 1) < 2") >= 0);
  assert(runCommerceBlock.indexOf("persistCheckpoint") >= 0);
  assert(source.indexOf("completePendingAssignmentControl(\"PAUSE\"") >= 0);
  assert(source.indexOf("completePendingAssignmentControl(\"STOP\"") >= 0);
}

testCommerceCardLiveRunsThreeMatchedRounds();
testCommerceCardLiveStopsGracefullyWhenNoMatchInRound();
testCommerceCardLiveBrowsesProductCardsBeforeTargetLiveSearch();
testCommerceCardLiveStopsAfterLaterNoMatchWithoutThirdRound();
testCommerceCardLiveUsesLiveTargetsBeforeLegacyCommerceConfig();
testCommerceCardLivePauseStopsBeforeScanning();
testCommerceCardLiveIsDisabledByDefault();
testCommerceCardLiveRequiresExplicitSendApproval();
testCollectorKeepsCommerceLiveSeparateFromOrdinaryLivePhase();
testDouyinProvidesDedicatedCommerceCardBrowseAdapter();
testMobileLogsPreferVisibleStorage();
testV2ProductNurtureUsesLiveFeedGateAndReusesRoom();
testV2ProductNurtureOnlyDoesNotSendComment();
testV2ProductNurtureFailsWhenTargetNotFoundAfterRounds();
testV2TargetCommentMissRefreshesAndFailsClosed();
testV2StopBeforeSendFailsClosed();
testV2ExpiredPermitDoesNotSend();
testV2AccountChangeDoesNotSend();
testV2MissingLivePageDoesNotSend();
testV2SubmittingActionBecomesUnknownWithoutResend();
testV2LiveNurtureCompletesOnlyAfterPlannedWatch();
testV2LiveNurtureFailsWhenWatchTargetNotReached();
testV2CheckpointRemainsStructuredAfterCompletion();
testCollectorPreservesV2CheckpointAndCompletesDeferredControl();

console.log("commerce-card-live-runner tests passed");
