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

  function nowIso() {
    return new Date().toISOString();
  }

  function taskConfig() {
    return config.task.commerceCardLiveComment || {};
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
    taskScheduler.recordCheckpoint("live", {
      taskType: "live",
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
      taskType: "live",
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
      taskType: "live",
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

  function sendSimpleComment(commentText, roundIndex) {
    if (!douyin.sendLiveComment) {
      return { success: false, failureReason: "send_live_comment_missing" };
    }
    report("INFO", "商品卡直播评论准备发送随机评论", {
      phase: "commerce_card_live_comment_send",
      roundIndex: roundIndex,
      commentText: commentText
    });
    return douyin.sendLiveComment(commentText, {
      commentMode: "agri_chatbot",
      plannedDelayMs: 0
    });
  }

  function runCommerceCardLiveCommentTask(options) {
    options = options || {};
    var cfg = taskConfig();
    if (cfg.enabled === false && options.force !== true) {
      return finishFailure("commerce_card_live_disabled", "commerce_card_live_config", "");
    }

    counters.currentPhase = "commerce_card_live_comment";
    counters.phaseStartedAt = nowIso();
    counters.phaseEndedAt = "";
    counters.lastStopReason = "";

    var searchKeyword = options.searchKeyword || pickFirst(cfg.searchKeywords, ["夏橙"]);
    var matchKeywords = normalizeList(options.matchKeywords || cfg.matchKeywords, ["秭归", "夏橙"]);
    var liveSignals = normalizeList(cfg.liveSignals, ["直播中", "讲解中", "主播讲解", "进入直播间", "正在直播"]);
    var scanMinutes = Math.max(1, pickNumber(options.scanMinutesPerRound, pickNumber(cfg.scanMinutesPerRound, 15)));
    var watchMinutes = Math.max(0, pickNumber(options.watchMinutesPerLive, pickNumber(cfg.watchMinutesPerLive, 15)));
    var maxRounds = Math.max(1, pickNumber(options.maxRounds, pickNumber(cfg.maxRounds, 3)));
    var completedRounds = 0;

    report("INFO", "商品卡直播评论任务启动", {
      phase: "commerce_card_live_start",
      taskType: "live",
      searchKeyword: searchKeyword,
      matchKeywords: matchKeywords,
      scanMinutesPerRound: scanMinutes,
      watchMinutesPerLive: watchMinutes,
      maxRounds: maxRounds
    });

    if (!douyin.openMatchingCommerceLiveFromCards) {
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

      var searchResult = douyin.openMatchingCommerceLiveFromCards({
        searchKeyword: searchKeyword,
        matchKeywords: matchKeywords,
        liveSignals: liveSignals,
        scanMinutes: scanMinutes,
        shouldStop: shouldStop
      }) || {};

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
      var commentText = randomItem(cfg.commentPool);
      var sendResult = sendSimpleComment(commentText, roundIndex);
      report(sendResult && sendResult.success ? "INFO" : "WARN", "商品卡直播随机评论结果", {
        phase: "commerce_card_live_comment_result",
        roundIndex: roundIndex,
        success: !!(sendResult && sendResult.success),
        failureReason: sendResult && sendResult.failureReason || ""
      });

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
