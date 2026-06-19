function nowIso() {
  return new Date().toISOString();
}

function enabledWithLocalApproval(section) {
  return !!(section && section.enabled === true && section.manualExecutionApproved === true);
}

function createP3ExtensionActions(context) {
  context = context || {};
  var config = context.config || {};
  var logger = context.logger || {};
  var storage = context.storage;
  var uploader = context.uploader;
  var douyin = context.douyin;

  function extensions() {
    return config.p3Extensions || {};
  }

  function buildAction(type, status, reason, payload) {
    return {
      type: type,
      status: status,
      skipReason: reason || "",
      failureReason: "",
      payload: payload || {},
      plannedAt: nowIso(),
      sentAt: ""
    };
  }

  function mergePayload(meta, extra) {
    var payload = {};
    var key;
    meta = meta || {};
    extra = extra || {};
    for (key in meta) {
      if (Object.prototype.hasOwnProperty.call(meta, key)) {
        payload[key] = meta[key];
      }
    }
    for (key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        payload[key] = extra[key];
      }
    }
    return payload;
  }

  function audit(action) {
    var payload = action.payload || {};
    var entry = {
      type: "p3_extension_action",
      taskId: config.task && config.task.taskId,
      deviceId: config.device && config.device.deviceId,
      actionType: action.type,
      triggerEventId: ["p3", action.type, payload.sampleIndex || 0, payload.nickname || payload.targetAccountName || ""].join(":").slice(0, 120),
      platform: config.task && config.task.platform || "douyin",
      roomName: payload.roomName || "",
      leaderAccountName: payload.nickname || payload.targetAccountName || "",
      triggerText: payload.commentText || action.type,
      matchedKeywords: [action.type],
      replyText: action.type === "authorized_follow" ? "P3 authorized follow audit" : "P3 live like audit",
      plannedDelayMs: 0,
      status: action.status,
      skipReason: action.skipReason || "",
      failureReason: action.failureReason || "",
      plannedAt: action.plannedAt,
      sentAt: action.sentAt || "",
      reportedAt: nowIso(),
      rawPayload: {
        actionType: action.type,
        payload: payload,
        localOnlyExecution: true
      },
      payload: payload
    };
    if (storage && storage.appendLiveCommentLog) {
      storage.appendLiveCommentLog(entry);
    }
    if (uploader && uploader.uploadLiveCommentAction) {
      uploader.uploadLiveCommentAction(entry);
    }
    if (logger.info) {
      logger.info("P3 extension action audited", entry);
    }
    return entry;
  }

  function planLiveLike(meta) {
    var liveLike = extensions().liveLike || {};
    var payload = mergePayload(meta, {
      maxLikes: liveLike.maxLikesPerLiveRoom || 1
    });
    if (!liveLike.enabled) {
      return buildAction("live_like", "skipped", "live_like_disabled", payload);
    }
    if (!enabledWithLocalApproval(liveLike)) {
      return buildAction("live_like", "skipped", "manual_approval_required", payload);
    }
    return buildAction("live_like", "planned", "", payload);
  }

  function planAuthorizedFollow(meta) {
    var follow = extensions().authorizedFollow || {};
    var payload = mergePayload(meta, {
      targetAccountId: follow.targetAccountId || "",
      targetAccountName: follow.targetAccountName || ""
    });
    if (!follow.enabled) {
      return buildAction("authorized_follow", "skipped", "authorized_follow_disabled", payload);
    }
    if (!enabledWithLocalApproval(follow) || follow.requireEmployeeAuthorization !== true) {
      return buildAction("authorized_follow", "skipped", "employee_authorization_required", payload);
    }
    if (!follow.targetAccountId && !follow.targetAccountName) {
      return buildAction("authorized_follow", "skipped", "target_account_missing", payload);
    }
    return buildAction("authorized_follow", "planned", "", payload);
  }

  function execute(action) {
    if (!action || action.status !== "planned") {
      return action;
    }
    if (action.type === "live_like" && douyin && douyin.likeCurrentLiveRoom) {
      var likeResult = douyin.likeCurrentLiveRoom(action.payload || {});
      action.status = likeResult && likeResult.success ? "sent" : "failed";
      action.failureReason = likeResult && likeResult.failureReason || "";
      action.sentAt = action.status === "sent" ? nowIso() : "";
      return action;
    }
    if (action.type === "authorized_follow" && douyin && douyin.followAuthorizedAccount) {
      var followResult = douyin.followAuthorizedAccount(action.payload || {});
      action.status = followResult && followResult.success ? "sent" : "failed";
      action.failureReason = followResult && followResult.failureReason || "";
      action.sentAt = action.status === "sent" ? nowIso() : "";
      return action;
    }
    action.status = "failed";
    action.failureReason = "adapter_method_missing";
    return action;
  }

  function planFromLiveSample(sample) {
    var classifiedComments = sample && sample.classifiedComments || [];
    var actions = [];
    for (var i = 0; i < classifiedComments.length; i++) {
      var item = classifiedComments[i];
      if (!item || item.type !== "follow_event") {
        continue;
      }
      var meta = {
        sampleIndex: sample.index,
        commentText: item.text,
        confidence: item.confidence,
        nickname: item.fields && item.fields.nickname || ""
      };
      actions.push(planLiveLike(meta));
      actions.push(planAuthorizedFollow(meta));
    }
    for (var j = 0; j < actions.length; j++) {
      if (actions[j].status === "planned") {
        actions[j] = execute(actions[j]);
      }
      audit(actions[j]);
    }
    return actions;
  }

  return {
    planLiveLike: planLiveLike,
    planAuthorizedFollow: planAuthorizedFollow,
    planFromLiveSample: planFromLiveSample
  };
}

module.exports = {
  createP3ExtensionActions: createP3ExtensionActions
};
