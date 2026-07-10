function createCommerceCardLiveRunner(context) {
  var config = context.config;
  var logger = context.logger;
  var douyin = context.douyin;
  var counters = context.counters;
  var controlLoop = context.controlLoop;
  var floatyControl = context.floatyControl;
  var heartbeatService = context.heartbeatService;
  var riskDetector = context.riskDetector;
  var taskScheduler = context.taskScheduler;
  var storage = context.storage;
  var uploader = context.uploader;
  var commentedRoomKeys = {};

  function nowIso() {
    return new Date().toISOString();
  }

  function taskConfig() {
    var liveTarget = pickLiveTarget("commerce_card_live_comment");
    if (liveTarget) {
      return buildCommerceConfigFromLiveTarget(liveTarget, config.task.commerceCardLiveComment || {});
    }
    return config.task.commerceCardLiveComment || {};
  }

  function pickLiveTarget(featureType) {
    var liveTargets = config.task.liveTargets || [];
    for (var i = 0; i < liveTargets.length; i++) {
      var target = liveTargets[i] || {};
      if (target.enabled !== false && target.featureType === featureType) {
        return target;
      }
    }
    return null;
  }

  function targetAliasKeywords(target) {
    var aliases = target.aliases || [];
    var result = [];
    for (var i = 0; i < aliases.length; i++) {
      if (aliases[i] && aliases[i].enabled === false) {
        continue;
      }
      var text = aliases[i] && aliases[i].aliasText;
      if (text) {
        result.push(text);
      }
    }
    return result;
  }

  function buildTargetRoomFromLiveTarget(target) {
    return {
      enabled: target.enabled !== false,
      targetCode: target.targetCode || "",
      targetName: target.targetName || "",
      searchKeywords: target.searchKeywords || [],
      matchKeywords: targetAliasKeywords(target),
      requiredKeywords: target.requiredKeywords || [],
      forbiddenKeywords: target.forbiddenKeywords || [],
      aliases: target.aliases || [],
      similarityThreshold: target.similarityThreshold || 0.9
    };
  }

  function buildCommerceConfigFromLiveTarget(target, legacy) {
    var runtime = target.runtimeConfig || {};
    var productKeywords = normalizeList(target.productKeywords, []);
    if (!productKeywords.length) {
      productKeywords = targetAliasKeywords(target);
    }
    return {
      enabled: target.enabled !== false,
      executeEnabled: runtime.executeEnabled === true || legacy.executeEnabled === true,
      manualExecutionApproved: runtime.manualExecutionApproved === true || legacy.manualExecutionApproved === true,
      searchKeywords: normalizeList(target.searchKeywords, legacy.searchKeywords || ["夏橙"]),
      matchKeywords: normalizeList(productKeywords, legacy.matchKeywords || ["秭归", "夏橙"]),
      liveSignals: normalizeList(target.liveSignals, legacy.liveSignals || ["直播中", "讲解中", "主播讲解", "进入直播间", "正在直播"]),
      scanMinutesPerRound: pickNumber(runtime.scanMinutesPerRound, pickNumber(legacy.scanMinutesPerRound, 15)),
      watchMinutesPerLive: pickNumber(runtime.watchMinutesPerLive, pickNumber(legacy.watchMinutesPerLive, 15)),
      maxRounds: pickNumber(runtime.maxRounds, pickNumber(legacy.maxRounds, 3)),
      maxCommentsPerRoom: pickNumber(runtime.maxCommentsPerRoom, pickNumber(legacy.maxCommentsPerRoom, 1)),
      commentPool: normalizeList(runtime.commentPool, legacy.commentPool || ["111", "666", "👍", "🌹", "😊"]),
      targetRoom: buildTargetRoomFromLiveTarget(target)
    };
  }

  function normalizeList(value, fallback) {
    var source = value;
    if (typeof source === "string") {
      source = source.split(/[\n,，]/);
    }
    source = source && source.length ? source : fallback || [];
    var result = [];
    for (var i = 0; i < source.length; i++) {
      var item = String(source[i] || "").replace(/\s+/g, " ").trim();
      if (item) {
        result.push(item);
      }
    }
    return result;
  }

  function pickFirst(value, fallback) {
    var list = normalizeList(value, fallback);
    return list.length ? list[0] : "";
  }

  function randomItem(list) {
    list = normalizeList(list, ["111", "666", "👍", "🌹", "😊"]);
    return list[Math.floor(Math.random() * list.length)];
  }

  function hashText(text) {
    text = String(text || "").replace(/\s+/g, " ").trim();
    var hash = 0;
    for (var i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  function pickNumber(value, fallback) {
    var numberValue = Number(value);
    if (value === undefined || value === null || isNaN(numberValue)) {
      return fallback;
    }
    return numberValue;
  }

  function report(level, message, payload) {
    payload = payload || {};
    if (logger && logger[String(level || "info").toLowerCase()]) {
      logger[String(level || "info").toLowerCase()](message, payload);
    }
    if (controlLoop && controlLoop.reportRuntimeLog) {
      controlLoop.reportRuntimeLog(String(level || "INFO").toUpperCase(), message, payload);
    }
  }

  function setStopReason(reason) {
    counters.lastStopReason = reason || counters.lastStopReason || "";
  }

  function shouldStop() {
    var state = floatyControl && floatyControl.state || {};
    if (state.exitRequested) {
      setStopReason("manual_exit");
      return true;
    }
    if (state.stopRequested) {
      setStopReason("manual_stop");
      return true;
    }
    if (state.paused) {
      setStopReason("manual_pause");
      return true;
    }
    return false;
  }

  function persistCheckpoint(extra) {
    if (!taskScheduler || !taskScheduler.recordCheckpoint) {
      return;
    }
    taskScheduler.recordCheckpoint("commerce_card_live_comment", {
      taskType: "commerce_card_live_comment",
      sceneType: "commerce_card_live_comment",
      checkpointType: extra && extra.checkpointType || "commerce_card_live_checkpoint",
      currentPhase: counters.currentPhase,
      liveRoomEnteredCount: counters.liveRoomEnteredCount,
      liveViewedCount: counters.liveViewedCount,
      lastStopReason: counters.lastStopReason,
      phaseStartedAt: counters.phaseStartedAt,
      phaseEndedAt: counters.phaseEndedAt,
      extra: extra || {}
    });
  }

  function buildRoomKey(searchResult, textSample) {
    searchResult = searchResult || {};
    var source = String([
      searchResult.roomName || "",
      searchResult.anchorName || "",
      searchResult.textSample || "",
      textSample || ""
    ].join(" ")).replace(/\s+/g, " ").trim();
    return source ? hashText(source.slice(0, 300)) : "";
  }

  function buildActionLogEntry(status, roundIndex, commentText, searchResult, extra) {
    extra = extra || {};
    return {
      type: "commerce_card_live_comment_result",
      sampleIndex: roundIndex,
      taskId: config.task.taskId,
      deviceId: config.device && config.device.deviceId || "",
      groupName: "commerce_card",
      triggerEventId: "commerce_card_live:" + roundIndex + ":" + nowIso(),
      triggerText: searchResult && searchResult.textSample || "",
      triggerAuthor: "",
      leaderAccountName: "",
      matchedKeywords: searchResult && searchResult.matchedKeywords || [],
      confidence: 1,
      roomName: searchResult && (searchResult.roomName || searchResult.anchorName) || "",
      replyText: commentText || "",
      plannedDelayMs: 0,
      status: status,
      skipReason: extra.skipReason || "",
      failureReason: extra.failureReason || "",
      plannedAt: nowIso(),
      sentAt: extra.sentAt || "",
      rawPayload: {
        sceneType: "commerce_card_live_comment",
        roundIndex: roundIndex,
        searchResult: searchResult || {}
      }
    };
  }

  function logCommerceCommentAction(status, roundIndex, commentText, searchResult, extra) {
    var entry = buildActionLogEntry(status, roundIndex, commentText, searchResult, extra || {});
    if (storage && storage.appendLiveCommentLog) {
      storage.appendLiveCommentLog(entry);
    }
    if (uploader && uploader.uploadLiveCommentAction) {
      uploader.uploadLiveCommentAction(entry);
    }
    return entry;
  }

  function readVisibleText() {
    try {
      if (douyin.extractFastText) {
        var data = douyin.extractFastText();
        return data && data.combinedText ? String(data.combinedText) : "";
      }
    } catch (error) {
      report("WARN", "商品卡直播评论读取屏幕文本失败", {
        phase: "commerce_card_live_screen_read",
        message: String(error)
      });
    }
    return "";
  }

  function detectRisk(stage) {
    var text = readVisibleText();
    if (riskDetector && riskDetector.containsRisk && riskDetector.containsRisk(config, text)) {
      return finishFailure("risk_control", stage || "commerce_card_live_risk", text);
    }
    return null;
  }

  function sleepMs(ms) {
    if (ms > 0 && typeof sleep === "function") {
      sleep(ms);
    }
  }

  function sleepResponsive(totalMs, stage) {
    var endAt = Date.now() + Math.max(0, totalMs || 0);
    while (!shouldStop() && Date.now() < endAt) {
      if (controlLoop && controlLoop.waitWhilePaused) {
        controlLoop.waitWhilePaused();
      }
      if (controlLoop && controlLoop.pollControlCommandsAsync) {
        controlLoop.pollControlCommandsAsync(false);
      }
      if (heartbeatService && heartbeatService.writeHeartbeat) {
        heartbeatService.writeHeartbeat("live", Date.now(), endAt);
      }
      sleepMs(Math.min(1000, Math.max(0, endAt - Date.now())));
    }
    if (shouldStop()) {
      report("WARN", "商品卡直播评论观看阶段被中断", {
        phase: stage || "commerce_card_live_watch",
        stopReason: counters.lastStopReason
      });
      return false;
    }
    return true;
  }

  function finishFailure(reason, stage, textSample) {
    setStopReason(reason);
    counters.phaseEndedAt = nowIso();
    report(reason === "risk_control" ? "ERROR" : "WARN", "商品卡直播评论任务失败，已停止", {
      phase: stage || "commerce_card_live_comment",
      taskType: "commerce_card_live_comment",
      reason: reason,
      textSample: String(textSample || "").slice(0, 260)
    });
    persistCheckpoint({
      checkpointType: "commerce_card_live_failed",
      reason: reason,
      stage: stage || "commerce_card_live_comment",
      textSample: String(textSample || "").slice(0, 260)
    });
    return {
      success: false,
      reason: reason,
      stage: stage || "commerce_card_live_comment"
    };
  }

  function finishSuccess(reason, completedRounds, extra) {
    setStopReason(reason);
    counters.phaseEndedAt = nowIso();
    extra = extra || {};
    report("INFO", "商品卡直播评论任务结束", {
      phase: "commerce_card_live_finish",
      taskType: "commerce_card_live_comment",
      reason: reason,
      completedRounds: completedRounds,
      maxRounds: extra.maxRounds || 0
    });
    persistCheckpoint({
      checkpointType: "commerce_card_live_finished",
      reason: reason,
      completedRounds: completedRounds,
      maxRounds: extra.maxRounds || 0
    });
    return {
      success: true,
      reason: reason,
      completedRounds: completedRounds,
      maxRounds: extra.maxRounds || 0
    };
  }

  function sendSimpleComment(commentText, roundIndex, searchResult) {
    var cfg = taskConfig();
    if (!cfg.executeEnabled || cfg.manualExecutionApproved !== true) {
      logCommerceCommentAction("skipped", roundIndex, commentText, searchResult, {
        skipReason: "commerce_card_send_not_approved"
      });
      return { success: false, skipped: true, failureReason: "commerce_card_send_not_approved" };
    }
    if (!douyin.sendLiveComment) {
      return { success: false, failureReason: "send_live_comment_missing" };
    }
    report("INFO", "商品卡直播评论准备发送随机评论", {
      phase: "commerce_card_live_comment_send",
      roundIndex: roundIndex,
      commentText: commentText
    });
    return douyin.sendLiveComment(commentText, {
      commentMode: "commerce_card_live",
      plannedDelayMs: 0,
      allowUnconfiguredReply: true
    });
  }

  function pickTargetLiveKeyword(targetRoom, fallbackKeyword) {
    targetRoom = targetRoom || {};
    var searchKeywords = normalizeList(targetRoom.searchKeywords, []);
    if (searchKeywords.length) {
      return searchKeywords[0];
    }
    var targetName = String(targetRoom.targetName || "").replace(/\s+/g, " ").trim();
    if (targetName) {
      return targetName;
    }
    var matchKeywords = normalizeList(targetRoom.matchKeywords, []);
    if (matchKeywords.length) {
      return matchKeywords[0];
    }
    return String(fallbackKeyword || "").replace(/\s+/g, " ").trim();
  }

  function normalizeTargetLiveResult(result, fallback) {
    result = result || {};
    fallback = fallback || {};
    return {
      success: true,
      reason: result.reason || "target_live_room_found",
      source: result.source || "target_live_search",
      keyword: result.keyword || fallback.keyword || "",
      roomName: result.roomName || result.targetName || "",
      anchorName: result.anchorName || "",
      matchedKeywords: result.matchedKeywords || result.targetKeywords || fallback.matchedKeywords || [],
      textSample: result.textSample || fallback.textSample || "",
      browseResult: fallback.browseResult || {}
    };
  }

  function browseCardsThenOpenTargetLive(searchKeyword, matchKeywords, liveSignals, cfg, scanMinutes) {
    var targetRoom = cfg.targetRoom || {};
    var cardCount = Math.max(1, pickNumber(cfg.cardCount, pickNumber(cfg.browseCardCount, 4)));
    var browseResult = douyin.browseCommerceCards({
      searchKeyword: searchKeyword,
      matchKeywords: matchKeywords,
      liveSignals: liveSignals,
      targetRoom: targetRoom,
      scanMinutes: scanMinutes,
      cardCount: cardCount,
      shouldStop: shouldStop
    }) || {};
    if (!browseResult.success) {
      return browseResult;
    }
    if (shouldStop()) {
      return {
        success: false,
        reason: counters.lastStopReason || "manual_stop",
        browseResult: browseResult
      };
    }
    var targetKeyword = pickTargetLiveKeyword(targetRoom, searchKeyword);
    report("INFO", "commerce card browsing finished, start target live search", {
      phase: "commerce_card_target_live_search",
      searchKeyword: searchKeyword,
      targetKeyword: targetKeyword,
      browsedCount: browseResult.browsedCount || 0,
      targetRoomName: targetRoom.targetName || ""
    });
    if (!douyin.openTargetLiveRoomFromSearch) {
      return {
        success: false,
        reason: "target_live_adapter_missing",
        browseResult: browseResult
      };
    }
    var entered = douyin.openTargetLiveRoomFromSearch({
      keyword: targetKeyword,
      targetRoom: targetRoom,
      shouldStop: shouldStop
    });
    var targetResult = douyin.getLastTargetLiveSearchResult ? douyin.getLastTargetLiveSearchResult() || {} : {};
    if (!entered) {
      return {
        success: false,
        reason: targetResult.reason || "target_live_room_not_found",
        keyword: targetKeyword,
        matchedKeywords: targetResult.matchedKeywords || targetResult.targetKeywords || [],
        textSample: targetResult.textSample || browseResult.textSample || "",
        browseResult: browseResult,
        targetResult: targetResult
      };
    }
    return normalizeTargetLiveResult(targetResult, {
      keyword: targetKeyword,
      matchedKeywords: matchKeywords,
      textSample: browseResult.textSample || "",
      browseResult: browseResult
    });
  }

  function runCommerceCardLiveCommentTask(options) {
    options = options || {};
    var cfg = taskConfig();
    if (cfg.enabled !== true && options.force !== true) {
      return finishFailure("commerce_card_live_disabled", "commerce_card_live_config", "");
    }

    counters.currentPhase = "commerce_card_live_comment";
    counters.phaseStartedAt = nowIso();
    counters.phaseEndedAt = "";
    counters.lastStopReason = "";
    commentedRoomKeys = {};

    var searchKeyword = options.searchKeyword || pickFirst(cfg.searchKeywords, ["夏橙"]);
    var matchKeywords = normalizeList(options.matchKeywords || cfg.matchKeywords, ["秭归", "夏橙"]);
    var liveSignals = normalizeList(cfg.liveSignals, ["直播中", "讲解中", "主播讲解", "进入直播间", "正在直播"]);
    var scanMinutes = Math.max(1, pickNumber(options.scanMinutesPerRound, pickNumber(cfg.scanMinutesPerRound, 15)));
    var watchMinutes = Math.max(0, pickNumber(options.watchMinutesPerLive, pickNumber(cfg.watchMinutesPerLive, 15)));
    var maxRounds = Math.max(1, pickNumber(options.maxRounds, pickNumber(cfg.maxRounds, 3)));
    var completedRounds = 0;

    report("INFO", "商品卡直播评论任务启动", {
      phase: "commerce_card_live_start",
      taskType: "commerce_card_live_comment",
      searchKeyword: searchKeyword,
      matchKeywords: matchKeywords,
      scanMinutesPerRound: scanMinutes,
      watchMinutesPerLive: watchMinutes,
      maxRounds: maxRounds
    });

    if (!douyin.browseCommerceCards && !douyin.openMatchingCommerceLiveFromCards) {
      return finishFailure("commerce_live_adapter_missing", "commerce_card_live_start", "");
    }
    if (shouldStop()) {
      return finishFailure(counters.lastStopReason || "manual_stop", "commerce_card_live_start", "");
    }

    for (var roundIndex = 1; roundIndex <= maxRounds; roundIndex++) {
      var riskBeforeScan = detectRisk("commerce_card_live_before_scan");
      if (riskBeforeScan) {
        return riskBeforeScan;
      }
      if (shouldStop()) {
        return finishFailure(counters.lastStopReason || "manual_stop", "commerce_card_live_before_scan", readVisibleText());
      }
      if (floatyControl && floatyControl.update) {
        floatyControl.update({
          lastMessage: "商品卡直播第 " + roundIndex + "/" + maxRounds + " 轮"
        });
      }
      report("INFO", "商品卡直播开始扫描商品卡", {
        phase: "commerce_card_scan_start",
        roundIndex: roundIndex,
        searchKeyword: searchKeyword,
        matchKeywords: matchKeywords,
        scanMinutes: scanMinutes
      });

      var searchResult;
      if (douyin.browseCommerceCards && douyin.openTargetLiveRoomFromSearch) {
        searchResult = browseCardsThenOpenTargetLive(searchKeyword, matchKeywords, liveSignals, cfg, scanMinutes);
      } else {
        searchResult = douyin.openMatchingCommerceLiveFromCards({
          searchKeyword: searchKeyword,
          matchKeywords: matchKeywords,
          liveSignals: liveSignals,
          targetRoom: cfg.targetRoom,
          scanMinutes: scanMinutes,
          shouldStop: shouldStop
        }) || {};
      }

      if (shouldStop()) {
        return finishFailure(counters.lastStopReason || "manual_stop", "commerce_card_scan", readVisibleText());
      }
      if (!searchResult.success) {
        return finishSuccess(searchResult.reason || "commerce_live_not_found", completedRounds, {
          maxRounds: maxRounds
        });
      }

      counters.liveRoomEnteredCount = Number(counters.liveRoomEnteredCount || 0) + 1;
      var riskBeforeComment = detectRisk("commerce_card_live_before_comment");
      if (riskBeforeComment) {
        return riskBeforeComment;
      }
      var currentTextSample = readVisibleText();
      var roomKey = buildRoomKey(searchResult, currentTextSample);
      var maxCommentsPerRoom = Math.max(0, pickNumber(options.maxCommentsPerRoom, pickNumber(cfg.maxCommentsPerRoom, 1)));
      if (roomKey && commentedRoomKeys[roomKey]) {
        logCommerceCommentAction("skipped", roundIndex, "", searchResult, {
          skipReason: "commerce_card_room_already_commented"
        });
        report("INFO", "商品卡直播间已评论过，跳过重复发送", {
          phase: "commerce_card_live_comment_result",
          roundIndex: roundIndex,
          roomKey: roomKey
        });
      } else if (maxCommentsPerRoom <= 0) {
        logCommerceCommentAction("skipped", roundIndex, "", searchResult, {
          skipReason: "commerce_card_room_comment_limit_zero"
        });
      } else {
        var sentInRoom = 0;
        for (var commentIndex = 0; commentIndex < maxCommentsPerRoom; commentIndex++) {
          var commentText = randomItem(cfg.commentPool);
          var sendResult = sendSimpleComment(commentText, roundIndex, searchResult);
          var status = sendResult && sendResult.success ? "sent" : (sendResult && sendResult.skipped ? "skipped" : "failed");
          if (!sendResult || !sendResult.skipped) {
            logCommerceCommentAction(status, roundIndex, commentText, searchResult, {
              failureReason: sendResult && sendResult.failureReason || "",
              sentAt: sendResult && sendResult.sentAt || ""
            });
          }
          report(sendResult && sendResult.success ? "INFO" : "WARN", "商品卡直播随机评论结果", {
            phase: "commerce_card_live_comment_result",
            roundIndex: roundIndex,
            commentIndex: commentIndex + 1,
            success: !!(sendResult && sendResult.success),
            skipped: !!(sendResult && sendResult.skipped),
            failureReason: sendResult && sendResult.failureReason || ""
          });
          if (sendResult && sendResult.success) {
            sentInRoom += 1;
          }
        }
        if (roomKey && sentInRoom > 0) {
          commentedRoomKeys[roomKey] = true;
        }
      }

      counters.liveViewedCount = Number(counters.liveViewedCount || 0) + 1;
      if (watchMinutes > 0) {
        report("INFO", "商品卡直播开始观看", {
          phase: "commerce_card_live_watch",
          roundIndex: roundIndex,
          watchMinutes: watchMinutes
        });
        if (!sleepResponsive(watchMinutes * 60 * 1000, "commerce_card_live_watch")) {
          return finishFailure(counters.lastStopReason || "manual_stop", "commerce_card_live_watch", readVisibleText());
        }
      }
      completedRounds += 1;
      if (douyin.exitLiveRoom) {
        douyin.exitLiveRoom();
      }
      persistCheckpoint({
        checkpointType: "commerce_card_live_round_finished",
        roundIndex: roundIndex,
        completedRounds: completedRounds,
        searchResult: searchResult
      });
    }

    return finishSuccess("commerce_card_live_rounds_finished", completedRounds, {
      maxRounds: maxRounds
    });
  }

  return {
    runCommerceCardLiveCommentTask: runCommerceCardLiveCommentTask
  };
}

module.exports = {
  createCommerceCardLiveRunner: createCommerceCardLiveRunner
};
