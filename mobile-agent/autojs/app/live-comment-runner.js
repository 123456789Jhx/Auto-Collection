function createLiveCommentRunner(context) {
  var config = context.config;
  var logger = context.logger;
  var douyin = context.douyin;
  var counters = context.counters;
  var controlLoop = context.controlLoop;
  var floatyControl = context.floatyControl;
  var liveRoomSampler = context.liveRoomSampler;
  var riskDetector = context.riskDetector;
  var taskScheduler = context.taskScheduler;

  function nowIso() {
    return new Date().toISOString();
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
    var state = floatyControl && floatyControl.state;
    if (state && state.exitRequested) {
      setStopReason("manual_exit");
      return true;
    }
    if (state && state.stopRequested) {
      setStopReason("manual_stop");
      return true;
    }
    return false;
  }

  function persistCheckpoint(extra) {
    if (!taskScheduler || !taskScheduler.recordCheckpoint) {
      return;
    }
    taskScheduler.recordCheckpoint("live_comment", {
      taskType: "live_comment",
      sceneType: "live_comment",
      viewedCount: counters.viewedCount,
      liveViewedCount: counters.liveViewedCount,
      liveRoomEnteredCount: counters.liveRoomEnteredCount,
      liveCandidateCount: counters.liveCandidateCount,
      liveRejectedCount: counters.liveRejectedCount,
      capturedCount: counters.capturedCount,
      plannedVideoMinutes: counters.plannedVideoMinutes,
      plannedLiveMinutes: counters.plannedLiveMinutes,
      videoElapsedMinutes: counters.videoElapsedMinutes,
      videoRemainingMinutes: counters.videoRemainingMinutes,
      liveElapsedMinutes: counters.liveElapsedMinutes,
      liveRemainingMinutes: counters.liveRemainingMinutes,
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
      if (douyin.extractScreen) {
        var screen = douyin.extractScreen();
        return screen && screen.combinedText ? String(screen.combinedText) : "";
      }
    } catch (error) {
      report("WARN", "直播评论读取屏幕文本失败", {
        phase: "live_comment_screen_read",
        message: String(error)
      });
    }
    return "";
  }

  function stopForFailure(reason, stage, textSample) {
    setStopReason(reason);
    report(reason === "risk_control" ? "ERROR" : "WARN", "直播评论任务失败，已停止", {
      phase: stage || "live_comment",
      taskType: "live_comment",
      reason: reason,
      textSample: String(textSample || "").slice(0, 260)
    });
    if (floatyControl && floatyControl.update) {
      floatyControl.update({
        stopRequested: false,
        liveCommentControlStatus: "stopped",
        liveCommentExecutionEnabled: false,
        lastManualAction: reason,
        lastMessage: "直播评论停止：" + reason
      });
    }
    context.liveCommentPriorityRequested = false;
    context.liveCommentTargetRoomRefreshRequested = false;
    persistCheckpoint({
      checkpointType: "live_comment_failed",
      reason: reason,
      stage: stage || "live_comment",
      textSample: String(textSample || "").slice(0, 260)
    });
    return {
      success: false,
      reason: reason,
      stage: stage || "live_comment"
    };
  }

  function detectRisk(stage) {
    var text = readVisibleText();
    if (riskDetector && riskDetector.containsRisk && riskDetector.containsRisk(config, text)) {
      return stopForFailure("risk_control", stage || "live_comment_risk", text);
    }
    return null;
  }

  function buildTargetRoom() {
    var botConfig = config.task.liveCommentBotConfig || {};
    return botConfig.targetRoom || {};
  }

  function pickKeyword(targetRoom) {
    targetRoom = targetRoom || {};
    var titleKeywords = targetRoom.titleKeywords || [];
    var roomKeywords = targetRoom.roomKeywords || [];
    if (targetRoom.anchorName) {
      return String(targetRoom.anchorName).replace(/\s+/g, " ").trim();
    }
    if (titleKeywords.length > 0) {
      return String(titleKeywords[0]).replace(/\s+/g, " ").trim();
    }
    if (roomKeywords.length > 0) {
      return String(roomKeywords[0]).replace(/\s+/g, " ").trim();
    }
    return "";
  }

  function hasTargetRoom(targetRoom) {
    return targetRoom && targetRoom.enabled === true && !!pickKeyword(targetRoom);
  }

  function sampleTargetRoom() {
    if (!liveRoomSampler || !liveRoomSampler.sampleCurrentRoom) {
      return {
        enabled: false,
        sampleCount: 0,
        stopReason: "live_room_sampler_missing"
      };
    }
    return liveRoomSampler.sampleCurrentRoom({
      shouldStop: shouldStop
    });
  }

  function finishSuccess(keyword, searchResult, liveRoomSample) {
    counters.phaseEndedAt = nowIso();
    counters.liveRoomEnteredCount = Math.max(1, Number(counters.liveRoomEnteredCount || 0));
    counters.lastStopReason = "live_comment_finished";
    context.liveCommentPriorityRequested = false;
    context.liveCommentTargetRoomRefreshRequested = false;
    report("INFO", "直播评论任务完成", {
      phase: "live_comment_finish",
      taskType: "live_comment",
      keyword: keyword,
      searchResult: searchResult || {},
      sampleCount: liveRoomSample ? liveRoomSample.sampleCount : 0,
      sentActionCount: liveRoomSample ? liveRoomSample.sentActionCount : 0,
      failedActionCount: liveRoomSample ? liveRoomSample.failedActionCount : 0,
      skippedActionCount: liveRoomSample ? liveRoomSample.skippedActionCount : 0
    });
    persistCheckpoint({
      checkpointType: "live_comment_finished",
      keyword: keyword,
      searchResult: searchResult || {},
      sampleCount: liveRoomSample ? liveRoomSample.sampleCount : 0
    });
    return {
      success: true,
      reason: "live_comment_finished",
      searchResult: searchResult || {},
      liveRoomSample: liveRoomSample || null
    };
  }

  function runTargetLiveCommentTask(options) {
    options = options || {};
    counters.currentPhase = "live_comment";
    counters.phaseStartedAt = nowIso();
    counters.phaseEndedAt = "";
    counters.lastStopReason = "";
    counters.plannedVideoMinutes = 0;
    counters.videoRemainingMinutes = 0;

    var targetRoom = options.targetRoom || buildTargetRoom();
    var keyword = String(options.keyword || pickKeyword(targetRoom) || "").replace(/\s+/g, " ").trim();
    report("INFO", "直播评论独立任务启动", {
      phase: "live_comment_start",
      taskType: "live_comment",
      keyword: keyword,
      anchorName: targetRoom.anchorName || ""
    });

    if (!hasTargetRoom(targetRoom)) {
      return stopForFailure("target_room_required", "live_comment_config", "");
    }
    if (shouldStop()) {
      return stopForFailure(counters.lastStopReason || "manual_stop", "live_comment_start", "");
    }
    var riskAtStart = detectRisk("live_comment_before_search");
    if (riskAtStart) {
      return riskAtStart;
    }

    if (!douyin.openTargetLiveRoomFromSearch || !douyin.openTargetLiveRoomFromSearch({ keyword: keyword, targetRoom: targetRoom })) {
      var searchResult = douyin.getLastTargetLiveSearchResult ? douyin.getLastTargetLiveSearchResult() : {};
      var reason = searchResult.reason || "target_live_room_search_failed";
      var text = readVisibleText();
      var riskAfterSearch = detectRisk("live_comment_search_failed");
      if (riskAfterSearch) {
        return riskAfterSearch;
      }
      return stopForFailure(reason, "live_comment_target_search", text);
    }

    var verifiedSearchResult = douyin.getLastTargetLiveSearchResult ? douyin.getLastTargetLiveSearchResult() : {};
    report("INFO", "直播评论已进入目标直播间", {
      phase: "target_room_verified",
      taskType: "live_comment",
      keyword: keyword,
      searchResult: verifiedSearchResult
    });

    var riskBeforeSample = detectRisk("live_comment_before_sample");
    if (riskBeforeSample) {
      return riskBeforeSample;
    }
    if (shouldStop()) {
      return stopForFailure(counters.lastStopReason || "manual_stop", "live_comment_before_sample", readVisibleText());
    }

    var liveRoomSample = sampleTargetRoom();
    if (liveRoomSample && liveRoomSample.stopReason === "blocked") {
      return stopForFailure("risk_control", "live_comment_sample", readVisibleText());
    }
    if (liveRoomSample && liveRoomSample.stopReason === "outside_douyin") {
      return stopForFailure("outside_douyin", "live_comment_sample", readVisibleText());
    }
    if (liveRoomSample && liveRoomSample.stopReason === "consecutive_comment_failures") {
      return stopForFailure("consecutive_comment_failures", "live_comment_sample", readVisibleText());
    }
    if (shouldStop()) {
      return stopForFailure(counters.lastStopReason || "manual_stop", "live_comment_sample", readVisibleText());
    }

    var riskAfterSample = detectRisk("live_comment_after_sample");
    if (riskAfterSample) {
      return riskAfterSample;
    }
    return finishSuccess(keyword, verifiedSearchResult, liveRoomSample);
  }

  return {
    runTargetLiveCommentTask: runTargetLiveCommentTask
  };
}

module.exports = {
  createLiveCommentRunner: createLiveCommentRunner
};
