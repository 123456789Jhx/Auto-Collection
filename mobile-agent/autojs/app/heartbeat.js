function createHeartbeatService(context) {
  var config = context.config;
  var logger = context.logger;
  var uploader = context.uploader;
  var floatyControl = context.floatyControl;
  var counters = context.counters;
  var heartbeat = context.heartbeat;
  var douyin = context.douyin;
  var realtimeLogSync = context.realtimeLogSync || {
    lastAt: 0,
    running: false
  };
  context.realtimeLogSync = realtimeLogSync;

  heartbeat.douyinAccountName = heartbeat.douyinAccountName || "";
  heartbeat.douyinAccountNameLastAt = heartbeat.douyinAccountNameLastAt || 0;
  heartbeat.douyinAccountNameRefreshing = false;

  function currentTaskType() {
    return context.taskScheduler && context.taskScheduler.getActiveTaskType ? context.taskScheduler.getActiveTaskType() : "";
  }

  function normalizeHeartbeatSceneType(sceneType) {
    var value = String(sceneType || "");
    if (value === "commerce_card_live_comment" || value === "live_comment") {
      return "live";
    }
    return value === "video" || value === "live" ? value : "";
  }

  function accountRefreshIntervalMs() {
    return Math.max(10 * 60 * 1000, Number(config.runtime.douyinAccountNameRefreshMinutes || 360) * 60 * 1000);
  }

  function accountPayload() {
    return {
      douyinAccountName: heartbeat.douyinAccountName || "",
      douyinAccountNameUpdatedAt: heartbeat.douyinAccountNameLastAt ? new Date(heartbeat.douyinAccountNameLastAt).toISOString() : ""
    };
  }

  function realtimeLogUploadEnabled() {
    return !!(config.upload && config.upload.enabled && config.upload.realtimeLogUploadEnabled !== false);
  }

  function realtimeLogUploadIntervalMs() {
    return Math.max(60 * 1000, Number(config.upload && config.upload.realtimeLogUploadIntervalSeconds || 120) * 1000);
  }

  function uploadCurrentLogNow(filePath, reason) {
    try {
      uploader.uploadLogFile(filePath);
    } catch (error) {
      logger.warn("实时完整日志同步失败", { reason: reason, message: String(error) });
    } finally {
      realtimeLogSync.running = false;
    }
  }

  function maybeUploadCurrentLog(reason) {
    if (!realtimeLogUploadEnabled() || !uploader || !uploader.uploadLogFile || !logger.getLogFile) {
      return;
    }
    var now = Date.now();
    if (realtimeLogSync.running || now - realtimeLogSync.lastAt < realtimeLogUploadIntervalMs()) {
      return;
    }
    var filePath = logger.getLogFile();
    if (!filePath) {
      return;
    }
    realtimeLogSync.lastAt = now;
    realtimeLogSync.running = true;
    if (typeof threads !== "undefined" && threads.start) {
      try {
        threads.start(function () {
          uploadCurrentLogNow(filePath, reason);
        });
        return;
      } catch (error) {
        realtimeLogSync.running = false;
        logger.warn("实时完整日志同步线程启动失败", { reason: reason, message: String(error) });
      }
    }
    uploadCurrentLogNow(filePath, reason);
  }

  function shouldRefreshDouyinAccountName(force) {
    if (force) {
      return true;
    }
    if (!config.runtime.syncDouyinAccountName) {
      return false;
    }
    return !heartbeat.douyinAccountName || Date.now() - heartbeat.douyinAccountNameLastAt >= accountRefreshIntervalMs();
  }

  function refreshDouyinAccountName(force) {
    if (!shouldRefreshDouyinAccountName(force)) {
      return { success: true, skipped: true, accountName: heartbeat.douyinAccountName || "" };
    }
    if (heartbeat.douyinAccountNameRefreshing) {
      return { success: false, skipped: true, message: "refreshing" };
    }
    if (!douyin || !douyin.readCurrentAccountName) {
      return { success: false, skipped: true, message: "reader_missing" };
    }
    heartbeat.douyinAccountNameRefreshing = true;
    try {
      var result = douyin.readCurrentAccountName({ restoreFeed: true, allowOpenApp: false });
      if (result && result.success && result.accountName) {
        heartbeat.douyinAccountName = result.accountName;
        heartbeat.douyinAccountNameLastAt = Date.now();
        logger.info("抖音账号名缓存已刷新", accountPayload());
      }
      return result || { success: false, message: "empty_result" };
    } catch (error) {
      logger.warn("刷新抖音账号名失败", { message: String(error) });
      return { success: false, message: String(error) };
    } finally {
      heartbeat.douyinAccountNameRefreshing = false;
    }
  }

  function writeHeartbeat(sceneType, startMs, endAt) {
    var intervalMs = (config.runtime.idleHeartbeatSeconds || 60) * 1000;
    var now = Date.now();
    if (now - heartbeat.lastAt < intervalMs) {
      return;
    }
    heartbeat.lastAt = now;
    var uploadSceneType = normalizeHeartbeatSceneType(sceneType);
    var elapsedMinutes = Math.round((now - startMs) / 60000);
    var remainingMinutes = Math.max(0, Math.round((endAt - now) / 60000));
    if (uploadSceneType === "video") {
      counters.videoElapsedMinutes = elapsedMinutes;
      counters.videoRemainingMinutes = remainingMinutes;
    }
    if (uploadSceneType === "live") {
      counters.liveElapsedMinutes = elapsedMinutes;
      counters.liveRemainingMinutes = remainingMinutes;
    }
    var payload = {
      sceneType: uploadSceneType,
      elapsedMinutes: elapsedMinutes,
      remainingMinutes: remainingMinutes,
      expectedEndAt: new Date(endAt).toISOString(),
      plannedVideoMinutes: counters.plannedVideoMinutes || 0,
      plannedLiveMinutes: counters.plannedLiveMinutes || 0,
      videoElapsedMinutes: counters.videoElapsedMinutes || 0,
      videoRemainingMinutes: counters.videoRemainingMinutes,
      liveElapsedMinutes: counters.liveElapsedMinutes || 0,
      liveRemainingMinutes: counters.liveRemainingMinutes,
      viewedCount: counters.viewedCount,
      liveViewedCount: counters.liveViewedCount,
      liveRoomEnteredCount: counters.liveRoomEnteredCount,
      liveCandidateCount: counters.liveCandidateCount,
      liveRejectedCount: counters.liveRejectedCount,
      capturedCount: counters.capturedCount,
      paused: floatyControl.state.paused,
      stopRequested: floatyControl.state.stopRequested,
      status: floatyControl.state.paused ? "paused" : "running",
      currentTaskType: currentTaskType(),
      lastMessage: floatyControl.state.lastMessage,
      douyinAccountName: heartbeat.douyinAccountName || "",
      douyinAccountNameUpdatedAt: heartbeat.douyinAccountNameLastAt ? new Date(heartbeat.douyinAccountNameLastAt).toISOString() : "",
      reportedAt: new Date(now).toISOString()
    };
    logger.info("采集心跳", payload);
    uploader.uploadHeartbeat(payload);
    maybeUploadCurrentLog("heartbeat");
  }

  function reportImmediateHeartbeat(sceneType, status, message) {
    var heartbeatStatus = status || (floatyControl.state.paused ? "paused" : "running");
    var isActiveTask = heartbeatStatus === "running";
    var startedAt = isActiveTask && counters.phaseStartedAt ? new Date(counters.phaseStartedAt).getTime() : 0;
    var activeSceneType = isActiveTask ? normalizeHeartbeatSceneType(sceneType || counters.currentPhase || "") : "";
    var payload = {
      sceneType: activeSceneType,
      elapsedMinutes: isActiveTask && startedAt && !isNaN(startedAt) ? Math.max(0, Math.round((Date.now() - startedAt) / 60000)) : 0,
      remainingMinutes: null,
      expectedEndAt: null,
      plannedVideoMinutes: isActiveTask ? counters.plannedVideoMinutes || 0 : 0,
      plannedLiveMinutes: isActiveTask ? counters.plannedLiveMinutes || 0 : 0,
      videoElapsedMinutes: isActiveTask ? counters.videoElapsedMinutes || 0 : 0,
      videoRemainingMinutes: isActiveTask ? counters.videoRemainingMinutes : null,
      liveElapsedMinutes: isActiveTask ? counters.liveElapsedMinutes || 0 : 0,
      liveRemainingMinutes: isActiveTask ? counters.liveRemainingMinutes : null,
      viewedCount: isActiveTask ? counters.viewedCount : 0,
      liveViewedCount: isActiveTask ? counters.liveViewedCount : 0,
      liveRoomEnteredCount: isActiveTask ? counters.liveRoomEnteredCount : 0,
      liveCandidateCount: isActiveTask ? counters.liveCandidateCount : 0,
      liveRejectedCount: isActiveTask ? counters.liveRejectedCount : 0,
      capturedCount: isActiveTask ? counters.capturedCount : 0,
      paused: floatyControl.state.paused,
      stopRequested: floatyControl.state.stopRequested,
      status: heartbeatStatus,
      currentTaskType: currentTaskType(),
      lastMessage: message || floatyControl.state.lastMessage,
      douyinAccountName: heartbeat.douyinAccountName || "",
      douyinAccountNameUpdatedAt: heartbeat.douyinAccountNameLastAt ? new Date(heartbeat.douyinAccountNameLastAt).toISOString() : "",
      reportedAt: new Date().toISOString()
    };
    logger.info("即时状态心跳", payload);
    uploader.uploadHeartbeat(payload);
    maybeUploadCurrentLog("immediate_heartbeat");
  }

  function reportAgentHeartbeat(status, message, force) {
    var intervalMs = (config.runtime.idleHeartbeatSeconds || 60) * 1000;
    var now = Date.now();
    if (!force && heartbeat.agentLastAt && now - heartbeat.agentLastAt < intervalMs) {
      return;
    }
    heartbeat.agentLastAt = now;
    reportImmediateHeartbeat("", status || "idle", message || floatyControl.state.lastMessage);
  }

  return {
    writeHeartbeat: writeHeartbeat,
    reportImmediateHeartbeat: reportImmediateHeartbeat,
    reportAgentHeartbeat: reportAgentHeartbeat,
    refreshDouyinAccountName: refreshDouyinAccountName
  };
}

module.exports = {
  createHeartbeatService: createHeartbeatService
};
