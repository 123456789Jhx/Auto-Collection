function createHeartbeatService(context) {
  var config = context.config;
  var logger = context.logger;
  var uploader = context.uploader;
  var floatyControl = context.floatyControl;
  var counters = context.counters;
  var heartbeat = context.heartbeat;

  function writeHeartbeat(sceneType, startMs, endAt) {
    var intervalMs = (config.runtime.idleHeartbeatSeconds || 60) * 1000;
    var now = Date.now();
    if (now - heartbeat.lastAt < intervalMs) {
      return;
    }
    heartbeat.lastAt = now;
    var elapsedMinutes = Math.round((now - startMs) / 60000);
    var remainingMinutes = Math.max(0, Math.round((endAt - now) / 60000));
    if (sceneType === "video") {
      counters.videoElapsedMinutes = elapsedMinutes;
      counters.videoRemainingMinutes = remainingMinutes;
    }
    if (sceneType === "live") {
      counters.liveElapsedMinutes = elapsedMinutes;
      counters.liveRemainingMinutes = remainingMinutes;
    }
    var payload = {
      sceneType: sceneType,
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
      lastMessage: floatyControl.state.lastMessage,
      reportedAt: new Date(now).toISOString()
    };
    logger.info("采集心跳", payload);
    uploader.uploadHeartbeat(payload);
  }

  function reportImmediateHeartbeat(sceneType, status, message) {
    var heartbeatStatus = status || (floatyControl.state.paused ? "paused" : "running");
    var isAgentIdle = heartbeatStatus === "idle" || heartbeatStatus === "stopped";
    var startedAt = !isAgentIdle && counters.phaseStartedAt ? new Date(counters.phaseStartedAt).getTime() : 0;
    var payload = {
      sceneType: isAgentIdle ? "" : sceneType || counters.currentPhase || "",
      elapsedMinutes: startedAt && !isNaN(startedAt) ? Math.max(0, Math.round((Date.now() - startedAt) / 60000)) : 0,
      remainingMinutes: null,
      expectedEndAt: null,
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
      status: heartbeatStatus,
      lastMessage: message || floatyControl.state.lastMessage,
      reportedAt: new Date().toISOString()
    };
    logger.info("即时状态心跳", payload);
    uploader.uploadHeartbeat(payload);
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
    reportAgentHeartbeat: reportAgentHeartbeat
  };
}

module.exports = {
  createHeartbeatService: createHeartbeatService
};
