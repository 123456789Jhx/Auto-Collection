function createRunRequestResolver(context) {
  context = context || {};

  var pendingTaskType = "";
  var pendingTaskTypeSource = "";
  var pendingTaskTypeAt = 0;
  var lastResolvedSource = "";

  function directNormalizeTaskType(taskType) {
    var value = String(taskType || "").trim();
    if (value === "live_comment_control" || value === "liveComment" || value === "live-comment") {
      value = "live_comment";
    }
    if (value === "video_control" || value === "video_feed") {
      value = "video";
    }
    if (value === "live_control" || value === "live_feed") {
      value = "live";
    }
    if (value === "video" || value === "live" || value === "live_comment") {
      return value;
    }
    return "";
  }

  function normalizeTaskType(taskType, fallbackTaskType) {
    var normalized = directNormalizeTaskType(taskType);
    if (normalized) {
      return normalized;
    }
    return directNormalizeTaskType(fallbackTaskType);
  }

  function setPendingTaskType(taskType, source) {
    var normalized = normalizeTaskType(taskType);
    if (!normalized) {
      return "";
    }
    pendingTaskType = normalized;
    pendingTaskTypeSource = source || "unknown";
    pendingTaskTypeAt = Date.now();
    return normalized;
  }

  function peekPendingTaskType() {
    return pendingTaskType;
  }

  function getPendingTaskSource() {
    return pendingTaskTypeSource;
  }

  function getPendingTaskAt() {
    return pendingTaskTypeAt;
  }

  function consumePendingTaskType() {
    var value = pendingTaskType;
    if (!value) {
      return "";
    }
    pendingTaskType = "";
    pendingTaskTypeSource = "";
    pendingTaskTypeAt = 0;
    return value;
  }

  function isLiveCommentPriorityRequested() {
    if (context.liveCommentPriorityRequested) {
      return true;
    }
    return !!(context.floatyControl &&
      context.floatyControl.state &&
      context.floatyControl.state.liveCommentControlStatus === "running");
  }

  function resolveRequestedTaskType() {
    var source = pendingTaskTypeSource || "pending";
    var pending = consumePendingTaskType();
    if (pending) {
      lastResolvedSource = source;
      return pending;
    }
    if (isLiveCommentPriorityRequested()) {
      lastResolvedSource = "live_comment_priority";
      return "live_comment";
    }
    if (context.taskScheduler && context.taskScheduler.getActiveTaskType) {
      var activeTaskType = normalizeTaskType(context.taskScheduler.getActiveTaskType());
      if (activeTaskType) {
        lastResolvedSource = "active_task";
        return activeTaskType;
      }
    }
    lastResolvedSource = "default";
    return "video";
  }

  function getLastResolvedSource() {
    return lastResolvedSource;
  }

  return {
    normalizeTaskType: normalizeTaskType,
    setPendingTaskType: setPendingTaskType,
    peekPendingTaskType: peekPendingTaskType,
    getPendingTaskSource: getPendingTaskSource,
    getPendingTaskAt: getPendingTaskAt,
    consumePendingTaskType: consumePendingTaskType,
    resolveRequestedTaskType: resolveRequestedTaskType,
    getLastResolvedSource: getLastResolvedSource
  };
}

module.exports = {
  createRunRequestResolver: createRunRequestResolver
};
