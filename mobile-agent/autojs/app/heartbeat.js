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
  var agentConnectionStore = null;
  try {
    agentConnectionStore = storages.create("AgriVideoCollectorAgentConnection");
  } catch (error) {
  }
  var lifecycleStore = null;
  try {
    lifecycleStore = storages.create("AgriVideoCollectorAgentLifecycle");
  } catch (error2) {
  }

  function lifecycleRead(key, fallback) {
    try { return lifecycleStore ? lifecycleStore.get(key, fallback) : fallback; } catch (error) { return fallback; }
  }

  function lifecycleWrite(key, value) {
    try { if (lifecycleStore) lifecycleStore.put(key, value); } catch (error) {}
  }

  function newSessionId() {
    try {
      if (typeof java !== "undefined" && java.util && java.util.UUID) return String(java.util.UUID.randomUUID().toString());
    } catch (error) {}
    return "agent-" + Date.now() + "-" + Math.floor(Math.random() * 1000000);
  }

  function initializeRunningLifecycle() {
    var state = String(lifecycleRead("agentLifecycleState", "") || "");
    var sessionId = String(lifecycleRead("agentSessionId", "") || "");
    if (state !== "RUNNING" || !sessionId) {
      sessionId = newSessionId();
      lifecycleWrite("agentSessionId", sessionId);
      lifecycleWrite("agentStateChangedAt", new Date().toISOString());
    }
    lifecycleWrite("agentLifecycleState", "RUNNING");
    lifecycleWrite("pollingEnabled", true);
    lifecycleWrite("agentStateReason", "AGENT_STARTED");
    return sessionId;
  }

  var lifecycleSessionId = initializeRunningLifecycle();

  function lifecyclePayload() {
    return {
      agentLifecycleState: String(lifecycleRead("agentLifecycleState", "RUNNING") || "RUNNING"),
      pollingEnabled: lifecycleRead("pollingEnabled", true) !== false,
      agentStateReason: String(lifecycleRead("agentStateReason", "AGENT_STARTED") || "AGENT_STARTED"),
      agentStateChangedAt: String(lifecycleRead("agentStateChangedAt", new Date().toISOString()) || ""),
      agentSessionId: String(lifecycleRead("agentSessionId", lifecycleSessionId) || lifecycleSessionId)
    };
  }

  function recordAgentConnection(result, status, message, taskType) {
    if (!agentConnectionStore) {
      return;
    }
    var now = Date.now();
    try {
      agentConnectionStore.put("lastAttemptAt", now);
      if (result && result.success) {
        agentConnectionStore.put("lastResult", "success");
        agentConnectionStore.put("lastSuccessAt", now);
        agentConnectionStore.put("httpStatus", Number(result.statusCode || 0));
        agentConnectionStore.put("lastStatus", String(status || "idle"));
        agentConnectionStore.put("lastMessage", String(message || ""));
        agentConnectionStore.put("currentTaskType", String(taskType || ""));
      } else {
        agentConnectionStore.put("lastResult", "failure");
        agentConnectionStore.put("lastFailureAt", now);
        agentConnectionStore.put("httpStatus", Number(result && result.statusCode || 0));
        agentConnectionStore.put("errorType", String(result && result.message || ""));
      }
    } catch (error2) {
    }
  }

  heartbeat.douyinAccountName = heartbeat.douyinAccountName || "";
  heartbeat.douyinAccountNameLastAt = heartbeat.douyinAccountNameLastAt || 0;
  heartbeat.douyinAccountNameRefreshing = false;

  function currentTaskType(isolated) {
    if (isolated === undefined) {
      isolated = isolatedCommentSnapshot();
    }
    if (isolated && isolated.taskType) {
      return isolated.taskType;
    }
    var scheduledTaskType = context.taskScheduler && context.taskScheduler.getActiveTaskType
      ? context.taskScheduler.getActiveTaskType() : "";
    if (scheduledTaskType) {
      return scheduledTaskType;
    }
    return "";
  }

  function isolatedCommentSnapshot() {
    var bridge = context.newCommentCommandBridge;
    if (!bridge) {
      return null;
    }
    var snapshot = null;
    try {
      if (typeof bridge.getStatusSnapshot === "function") {
        snapshot = bridge.getStatusSnapshot();
      }
      if (!snapshot && typeof bridge.getActive === "function") {
        var active = bridge.getActive();
        if (active) {
          var progress = active.latestProgress || {};
          snapshot = {
            status: active.stopRequested || active.terminal ? "stopped" : "running",
            stopRequested: !!active.stopRequested,
            runId: active.runId || active.commandId,
            batchId: active.batchId,
            featureKey: active.featureKey,
            taskType: "live_comment",
            stage: progress.stage || active.stage || "",
            lastMessage: progress.stage ? "隔离评论任务：" + progress.stage : "隔离评论任务执行中"
          };
        }
      }
    } catch (error) {
      logger.warn("读取隔离评论任务状态失败", { message: String(error) });
      return null;
    }
    if (!snapshot || typeof snapshot !== "object") {
      return null;
    }
    var status = String(snapshot.status || "running").toLowerCase();
    if (status !== "running" && status !== "paused" && status !== "stopped") {
      return null;
    }
    return {
      status: status,
      stopRequested: !!snapshot.stopRequested,
      runId: String(snapshot.runId || snapshot.commandId || ""),
      batchId: String(snapshot.batchId || ""),
      featureKey: String(snapshot.featureKey || "isolated_live_comment_entry"),
      taskType: String(snapshot.taskType || "live_comment"),
      stage: String(snapshot.stage || ""),
      lastMessage: String(snapshot.lastMessage || "隔离评论任务执行中")
    };
  }

  function isolatedCommentIsActive(snapshot) {
    return !!(snapshot && (snapshot.status === "running" || snapshot.status === "paused" ||
      snapshot.status === "stopped"));
  }

  function effectiveHeartbeatStatus(requestedStatus, snapshot) {
    var status = String(requestedStatus || "");
    if (snapshot) {
      if (snapshot.status === "stopped" && status !== "error") {
        return "stopped";
      }
      if (snapshot.status === "running" && status !== "stopped" && status !== "error") {
        return "running";
      }
      if (snapshot.status === "paused" && status !== "stopped" && status !== "error") {
        return "paused";
      }
    }
    return status || "idle";
  }

  function effectiveHeartbeatMessage(message, snapshot) {
    var text = String(message || "");
    if (snapshot && isolatedCommentIsActive(snapshot) &&
        (!text || text === "未执行任务" || text === "等待控制循环")) {
      return snapshot.lastMessage;
    }
    return text || floatyControl.state.lastMessage;
  }

  function currentWarmupRunIdentity(isolated) {
    if (isolated === undefined) {
      isolated = isolatedCommentSnapshot();
    }
    if (isolatedCommentIsActive(isolated)) {
      return {
        runId: isolated.runId,
        batchId: isolated.batchId,
        featureKey: isolated.featureKey
      };
    }
    var identity = context.accountWarmupRunIdentity;
    if (!identity && context.accountWarmupCommandBridge && context.accountWarmupCommandBridge.getActive) {
      var active = context.accountWarmupCommandBridge.getActive();
      identity = active && active.runIdentity;
    }
    identity = identity || {};
    return {
      runId: String(identity.runId || ""),
      batchId: String(identity.batchId || ""),
      featureKey: String(identity.featureKey || "")
    };
  }

  function agentCapabilities() {
    return {
      workflowVersion: 2,
      checkpointVersion: 2,
      pauseResume: true,
      stableRoomKey: true,
      idempotentComment: true,
      shortLivedCommentPermit: true
    };
  }

  function assignmentPayload(isolated) {
    if (isolated === undefined) {
      isolated = isolatedCommentSnapshot();
    }
    var taskType = currentTaskType(isolated);
    var assignment = !isolated && context.taskScheduler && context.taskScheduler.getAssignmentContext
      ? context.taskScheduler.getAssignmentContext(taskType)
      : null;
    var checkpoint = assignment && assignment.checkpoint || {};
    var stage = checkpoint.stage || checkpoint.currentStage || "";
    if (!stage && isolated) {
      stage = isolated.stage;
    }
    return {
      assignmentId: assignment && assignment.assignmentId || "",
      assignmentStateVersion: assignment && assignment.stateVersion || 0,
      stage: stage
    };
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

  function checkBizScripts(status) {
    if (status !== "idle") {
      return;
    }
    if (context.bizScriptUpdater && context.bizScriptUpdater.check) {
      context.bizScriptUpdater.check(false);
    }
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
    var isolated = isolatedCommentSnapshot();
    var uploadSceneType = normalizeHeartbeatSceneType(sceneType);
    if (isolated && isolated.status === "running") {
      uploadSceneType = "live";
    }
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
    var heartbeatStatus = effectiveHeartbeatStatus(
      floatyControl.state.paused ? "paused" : "running", isolated
    );
    var assignment = assignmentPayload(isolated);
    var runIdentity = currentWarmupRunIdentity(isolated);
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
      paused: isolated ? isolated.status === "paused" : floatyControl.state.paused,
      stopRequested: floatyControl.state.stopRequested || !!(isolated && isolated.stopRequested),
      status: heartbeatStatus,
      agentLifecycleState: lifecyclePayload().agentLifecycleState,
      pollingEnabled: lifecyclePayload().pollingEnabled,
      agentStateReason: lifecyclePayload().agentStateReason,
      agentStateChangedAt: lifecyclePayload().agentStateChangedAt,
      agentSessionId: lifecyclePayload().agentSessionId,
      runId: runIdentity.runId,
      batchId: runIdentity.batchId,
      featureKey: runIdentity.featureKey,
      currentTaskType: currentTaskType(isolated),
      assignmentId: assignment.assignmentId,
      assignmentStateVersion: assignment.assignmentStateVersion,
      stage: assignment.stage,
      capabilities: agentCapabilities(),
      lastMessage: effectiveHeartbeatMessage(floatyControl.state.lastMessage, isolated),
      douyinAccountName: heartbeat.douyinAccountName || "",
      douyinAccountNameUpdatedAt: heartbeat.douyinAccountNameLastAt ? new Date(heartbeat.douyinAccountNameLastAt).toISOString() : "",
      bizScriptsVersion: config.runtime.bizScriptsVersion || "0.0.0",
      bizScriptRuntime: config.runtime.bizScriptRuntimeState || null,
      pendingBizScriptsVersion: config.runtime.pendingBizScriptsVersion || null,
      reportedAt: new Date(now).toISOString()
    };
    logger.info("采集心跳", payload);
    var uploadResult = uploader.uploadHeartbeat(payload);
    recordAgentConnection(uploadResult, payload.status, payload.lastMessage, payload.currentTaskType);
    if (uploadResult && uploadResult.success && context.deviceRecoverySync) {
      context.deviceRecoverySync.recordStage("HEARTBEAT_RESTORED", { heartbeatStatus: payload.status }, undefined, true);
    }
    maybeUploadCurrentLog("heartbeat");
  }

  function reportImmediateHeartbeat(sceneType, status, message) {
    var isolated = isolatedCommentSnapshot();
    var heartbeatStatus = effectiveHeartbeatStatus(
      status || (floatyControl.state.paused ? "paused" : "running"), isolated
    );
    checkBizScripts(heartbeatStatus);
    var isActiveTask = heartbeatStatus === "running";
    var startedAt = isActiveTask && counters.phaseStartedAt ? new Date(counters.phaseStartedAt).getTime() : 0;
    var activeSceneType = isActiveTask ? normalizeHeartbeatSceneType(sceneType || counters.currentPhase || "") : "";
    if (isActiveTask && isolated) {
      activeSceneType = "live";
    }
    var assignment = assignmentPayload(isolated);
    var runIdentity = currentWarmupRunIdentity(isolated);
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
      paused: isolated ? isolated.status === "paused" : floatyControl.state.paused,
      stopRequested: floatyControl.state.stopRequested || !!(isolated && isolated.stopRequested),
      status: heartbeatStatus,
      agentLifecycleState: lifecyclePayload().agentLifecycleState,
      pollingEnabled: lifecyclePayload().pollingEnabled,
      agentStateReason: lifecyclePayload().agentStateReason,
      agentStateChangedAt: lifecyclePayload().agentStateChangedAt,
      agentSessionId: lifecyclePayload().agentSessionId,
      runId: runIdentity.runId,
      batchId: runIdentity.batchId,
      featureKey: runIdentity.featureKey,
      currentTaskType: currentTaskType(isolated),
      assignmentId: assignment.assignmentId,
      assignmentStateVersion: assignment.assignmentStateVersion,
      stage: assignment.stage,
      capabilities: agentCapabilities(),
      lastMessage: effectiveHeartbeatMessage(message, isolated),
      douyinAccountName: heartbeat.douyinAccountName || "",
      douyinAccountNameUpdatedAt: heartbeat.douyinAccountNameLastAt ? new Date(heartbeat.douyinAccountNameLastAt).toISOString() : "",
      bizScriptsVersion: config.runtime.bizScriptsVersion || "0.0.0",
      bizScriptRuntime: config.runtime.bizScriptRuntimeState || null,
      pendingBizScriptsVersion: config.runtime.pendingBizScriptsVersion || null,
      reportedAt: new Date().toISOString()
    };
    logger.info("即时状态心跳", payload);
    var uploadResult = uploader.uploadHeartbeat(payload);
    recordAgentConnection(uploadResult, payload.status, payload.lastMessage, payload.currentTaskType);
    if (uploadResult && uploadResult.success && context.deviceRecoverySync) {
      context.deviceRecoverySync.recordStage("HEARTBEAT_RESTORED", { heartbeatStatus: payload.status }, undefined, true);
    }
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
