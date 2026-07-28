function randomInt(min, max) {
  min = Math.floor(Number(min || 0));
  max = Math.floor(Number(max || min));
  if (max < min) {
    max = min;
  }
  return min + Math.floor(Math.random() * (max - min + 1));
}

function normalizeGroupName(value) {
  var name = String(value || "A").toUpperCase();
  return name === "B" || name === "C" ? name : "A";
}

function createCommentActionPlanner(options) {
  options = options || {};
  var groupName = normalizeGroupName(options.groupName);
  var replyPools = options.replyPools || {};
  var cooldownMs = Math.max(0, Number(options.perDeviceCooldownSeconds || 10) * 1000);
  var delayMinMs = Math.max(0, Number(options.sendDelayMinMs || 500));
  var delayMaxMs = Math.max(delayMinMs, Number(options.sendDelayMaxMs || 3000));
  var maxFailures = Math.max(1, Number(options.maxConsecutiveSendFailures || 3));
  var perTaskMaxComments = Math.max(1, Number(options.perTaskMaxComments || 60));
  var lowConfidenceAction = options.lowConfidenceAction || "log_only";
  var seenTriggerEvents = {};
  var lastActionAt = 0;
  var consecutiveFailures = 0;
  var plannedCount = 0;

  function updateOptions(nextOptions) {
    nextOptions = nextOptions || {};
    groupName = normalizeGroupName(nextOptions.groupName);
    replyPools = nextOptions.replyPools || {};
    cooldownMs = Math.max(0, Number(nextOptions.perDeviceCooldownSeconds || 10) * 1000);
    delayMinMs = Math.max(0, Number(nextOptions.sendDelayMinMs || 500));
    delayMaxMs = Math.max(delayMinMs, Number(nextOptions.sendDelayMaxMs || 3000));
    maxFailures = Math.max(1, Number(nextOptions.maxConsecutiveSendFailures || 3));
    perTaskMaxComments = Math.max(1, Number(nextOptions.perTaskMaxComments || 60));
    lowConfidenceAction = nextOptions.lowConfidenceAction || "log_only";
  }

  function pickReplyText() {
    var pool = replyPools[groupName] || replyPools.A || [];
    if (!pool.length) {
      return "";
    }
    return pool[randomInt(0, pool.length - 1)];
  }

  function skipped(triggerEvent, reason) {
    return {
      triggerEventId: triggerEvent && triggerEvent.eventId,
      taskId: triggerEvent && triggerEvent.taskId,
      deviceId: triggerEvent && triggerEvent.deviceId,
      roomName: triggerEvent && triggerEvent.roomName,
      leaderAccountName: triggerEvent && triggerEvent.leaderAccountName,
      triggerText: triggerEvent && triggerEvent.triggerText,
      matchedKeywords: triggerEvent && triggerEvent.matchedKeywords || [],
      triggerConfidence: triggerEvent && triggerEvent.confidence,
      groupName: groupName,
      replyText: "",
      plannedDelayMs: 0,
      status: "skipped",
      skipReason: reason,
      plannedAt: new Date().toISOString()
    };
  }

  function skipOnce(triggerEvent, reason) {
    if (triggerEvent && triggerEvent.eventId) {
      seenTriggerEvents[triggerEvent.eventId] = true;
    }
    return skipped(triggerEvent, reason);
  }

  function plan(triggerEvent, nowMs) {
    nowMs = nowMs || Date.now();
    if (!triggerEvent || !triggerEvent.eventId) {
      return skipped(triggerEvent || {}, "missing_trigger_event");
    }
    if (seenTriggerEvents[triggerEvent.eventId]) {
      return skipped(triggerEvent, "duplicate_trigger_event");
    }
    if (lowConfidenceAction === "log_only" && Number(triggerEvent.confidence || 0) < 0.7) {
      return skipOnce(triggerEvent, "low_confidence");
    }
    if (lastActionAt && nowMs - lastActionAt < cooldownMs) {
      return skipOnce(triggerEvent, "device_cooldown");
    }
    if (plannedCount >= perTaskMaxComments) {
      return skipOnce(triggerEvent, "task_comment_limit");
    }
    if (consecutiveFailures >= maxFailures) {
      return skipOnce(triggerEvent, "consecutive_failure_limit");
    }

    var replyText = pickReplyText();
    if (!replyText) {
      return skipOnce(triggerEvent, "empty_reply_pool");
    }

    var action = {
      triggerEventId: triggerEvent.eventId,
      taskId: triggerEvent.taskId,
      deviceId: triggerEvent.deviceId,
      roomName: triggerEvent.roomName || "",
      leaderAccountName: triggerEvent.leaderAccountName || "",
      triggerText: triggerEvent.triggerText || "",
      matchedKeywords: triggerEvent.matchedKeywords || [],
      triggerConfidence: triggerEvent.confidence,
      groupName: groupName,
      replyText: replyText,
      plannedDelayMs: randomInt(delayMinMs, delayMaxMs),
      status: "planned",
      skipReason: "",
      failureReason: "",
      plannedAt: new Date().toISOString()
    };
    seenTriggerEvents[triggerEvent.eventId] = true;
    plannedCount += 1;
    lastActionAt = nowMs;
    return action;
  }

  function recordResult(action, success, failureReason) {
    if (success) {
      consecutiveFailures = 0;
      return;
    }
    consecutiveFailures += 1;
    if (action) {
      action.status = "failed";
      action.failureReason = failureReason || "unknown";
    }
  }

  function shouldStopForFailures() {
    return consecutiveFailures >= maxFailures;
  }

  return {
    plan: plan,
    recordResult: recordResult,
    shouldStopForFailures: shouldStopForFailures,
    updateOptions: updateOptions,
    getState: function () {
      return {
        groupName: groupName,
        plannedCount: plannedCount,
        consecutiveFailures: consecutiveFailures,
        lastActionAt: lastActionAt
      };
    }
  };
}

module.exports = {
  createCommentActionPlanner: createCommentActionPlanner
};
