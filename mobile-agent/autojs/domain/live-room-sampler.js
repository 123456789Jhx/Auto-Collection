function uniqueByText(items) {
  var seen = {};
  var result = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var text = item && item.text;
    if (!text || seen[text]) {
      continue;
    }
    seen[text] = true;
    result.push(item);
  }
  return result;
}

function createLiveRoomSampler(context) {
  var config = context.config;
  var logger = context.logger;
  var douyin = context.douyin;
  var detector = context.liveRoomDetector;
  var reader = context.liveCommentReader;
  var classifier = context.liveCommentClassifier;
  var storage = context.storage;
  var uploader = context.uploader;
  var commentCache = context.liveCommentCache;
  var triggerDetector = context.liveTriggerDetector;
  var actionPlanner = context.liveCommentActionPlanner;
  var relevanceDetector = context.liveRoomRelevanceDetector;
  var agriCommentBotPlanner = context.agriCommentBotPlanner;
  var p3ExtensionActions = context.p3ExtensionActions;
  var expectedPackage = "com.ss.android.ugc.aweme";
  var targetRoomSendState = {
    sentCount: 0,
    lastSentAt: 0
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function getCurrentPackageName() {
    try {
      return currentPackage();
    } catch (error) {
      return "";
    }
  }

  function isControlStopped() {
    var state = context.floatyControl && context.floatyControl.state;
    return !!(state && (state.stopRequested || state.exitRequested));
  }

  function isTargetRoomRefreshRequested() {
    return context.liveCommentTargetRoomRefreshRequested === true;
  }

  function waitWhilePaused() {
    if (context.controlLoop && context.controlLoop.waitWhilePaused) {
      context.controlLoop.waitWhilePaused();
      return;
    }
    while (context.floatyControl && context.floatyControl.state && context.floatyControl.state.paused && !isControlStopped()) {
      sleep(300);
    }
  }

  function sleepMs(ms) {
    var endAt = Date.now() + Math.max(0, Number(ms || 1000));
    while (Date.now() < endAt) {
      if (isControlStopped() || isTargetRoomRefreshRequested()) {
        return false;
      }
      waitWhilePaused();
      if (isControlStopped() || isTargetRoomRefreshRequested()) {
        return false;
      }
      if (context.controlLoop && context.controlLoop.pollControlCommandsAsync) {
        context.controlLoop.pollControlCommandsAsync(false);
      }
      var remaining = endAt - Date.now();
      if (remaining <= 0) {
        break;
      }
      sleep(Math.min(300, remaining));
    }
    return true;
  }

  function captureText() {
    try {
      var data = douyin.extractFastText();
      return {
        text: data && data.combinedText ? data.combinedText : "",
        currentPackageName: data && data.currentPackageName ? data.currentPackageName : getCurrentPackageName(),
        scene: data && data.scene ? data.scene : "",
        sceneReasons: data && data.sceneReasons ? data.sceneReasons : []
      };
    } catch (error) {
      logger.warn("直播间只读采样文本读取失败", { message: String(error) });
      return {
        text: "",
        currentPackageName: getCurrentPackageName(),
        scene: "",
        sceneReasons: ["capture_failed"]
      };
    }
  }

  function planCommentActions(comments, sampleIndex) {
    var liveCommentConfig = config.task.liveComment || {};
    var addedComments = commentCache ? commentCache.addMany(comments, {
      sampledAt: nowIso(),
      source: "live_room_sampler"
    }) : comments;
    var triggerEvents = [];
    var plannedActions = [];
    if (!isLiveCommentControlRunning() || config.task.liveCommentMode !== "target_follow" || config.task.liveCommentRole !== "follower" || liveCommentConfig.enabled === false || !triggerDetector || !actionPlanner) {
      return {
        addedComments: addedComments,
        triggerEvents: triggerEvents,
        plannedActions: plannedActions
      };
    }

    var cachedComments = addedComments;
    for (var i = 0; i < cachedComments.length; i++) {
      var currentRoomName = getRoomNameFromText(cachedComments[i]);
      var triggerEvent = triggerDetector.detect(cachedComments[i], {
        taskId: config.task.taskId,
        deviceId: config.device.deviceId,
        roomName: currentRoomName
      });
      if (!triggerEvent) {
        continue;
      }
      var plannedAction = actionPlanner.plan(triggerEvent);
      triggerEvents.push(triggerEvent);
      plannedActions.push(plannedAction);
      logLiveCommentAction("live_comment_plan", sampleIndex, triggerEvent, plannedAction);
      maybeExecutePlannedAction(sampleIndex, triggerEvent, plannedAction);
    }
    return {
      addedComments: addedComments,
      triggerEvents: triggerEvents,
      plannedActions: plannedActions
    };
  }

  function planAgriChatbotAction(text, comments, sampleIndex) {
    var plannedActions = [];
    var triggerEvents = [];
    var botConfig = config.task.liveCommentBotConfig || {};
    if (!isLiveCommentControlRunning() || config.task.liveCommentMode !== "agri_chatbot" || botConfig.enabled === false || !relevanceDetector || !agriCommentBotPlanner) {
      return {
        triggerEvents: triggerEvents,
        plannedActions: plannedActions,
        roomRelevance: null
      };
    }

    var commentsText = (comments || []).map(function (item) {
      return item && (item.content || item.text || item.raw || item);
    }).join(" ");
    var roomName = getRoomNameFromText({ text: text });
    var targetRoom = botConfig.targetRoom || {};
    var targetMatch = matchTargetRoom(text, commentsText, roomName, targetRoom);
    if (targetRoom.enabled === true && !targetMatch.matched) {
      logger.info("指定直播间未命中，跳过评论计划", {
        roomName: roomName,
        reason: targetMatch.reason,
        anchorName: targetRoom.anchorName || "",
        titleKeywords: targetRoom.titleKeywords || [],
        roomKeywords: targetRoom.roomKeywords || []
      });
      return {
        triggerEvents: triggerEvents,
        plannedActions: plannedActions,
        roomRelevance: {
          related: false,
          score: 0,
          threshold: 100,
          matchedKeywords: [],
          negativeKeywords: [],
          reason: "target_room_not_matched"
        }
      };
    }
    var relevance = relevanceDetector.detect({
      text: text,
      commentsText: commentsText,
      roomName: roomName,
      accountProfile: config.task.accountProfile || {},
      botConfig: botConfig
    });
    if (targetRoom.enabled === true && targetMatch.matched) {
      relevance.related = true;
      relevance.score = Math.max(Number(relevance.score || 0), Number(relevance.threshold || 1));
      relevance.reason = targetRoom.allowRealSend === true ? "target_room_real_send_test" : "target_room_matched_plan_only";
    }
    var action = agriCommentBotPlanner.plan({
      taskId: config.task.taskId,
      deviceId: config.device.deviceId,
      platform: config.task.platform,
      roomName: roomName,
      textSample: text,
      roomRelevance: relevance,
      accountProfile: config.task.accountProfile || {},
      botConfig: botConfig,
      targetRoomMatched: targetMatch.matched,
      targetRoomReason: targetMatch.reason
    });
    plannedActions.push(action);
    triggerEvents.push({
      eventId: action.triggerEventId,
      taskId: config.task.taskId,
      deviceId: config.device.deviceId,
      roomName: roomName,
      leaderAccountName: action.leaderAccountName,
      triggerText: action.triggerText,
      matchedKeywords: action.matchedKeywords,
      confidence: relevance.score / 100,
      detectedAt: nowIso(),
      status: action.status
    });
    logLiveCommentAction("agri_chatbot_plan", sampleIndex, triggerEvents[0], action);
    maybeExecutePlannedAction(sampleIndex, triggerEvents[0], action);
    return {
      triggerEvents: triggerEvents,
      plannedActions: plannedActions,
      roomRelevance: relevance
    };
  }

  function isLiveCommentControlRunning() {
    var state = context.floatyControl && context.floatyControl.state;
    return !!state && state.liveCommentControlStatus === "running";
  }

  function buildActionLogEntry(type, sampleIndex, triggerEvent, action) {
    return {
      type: type,
      sampleIndex: sampleIndex,
      taskId: config.task.taskId,
      deviceId: config.device.deviceId,
      groupName: action.groupName,
      triggerEventId: triggerEvent.eventId,
      triggerText: triggerEvent.triggerText,
      triggerAuthor: triggerEvent.leaderAccountName,
      leaderAccountName: triggerEvent.leaderAccountName,
      matchedKeywords: triggerEvent.matchedKeywords,
      confidence: triggerEvent.confidence,
      roomName: triggerEvent.roomName,
      replyText: action.replyText,
      plannedDelayMs: action.plannedDelayMs,
      status: action.status,
      skipReason: action.skipReason,
      failureReason: action.failureReason || "",
      plannedAt: action.plannedAt,
      sentAt: action.sentAt || "",
      rawPayload: action.rawPayload || {}
    };
  }

  function logLiveCommentAction(type, sampleIndex, triggerEvent, action) {
    if (!storage || !storage.appendLiveCommentLog) {
      return;
    }
    var logEntry = buildActionLogEntry(type, sampleIndex, triggerEvent, action);
    storage.appendLiveCommentLog(logEntry);
    if (uploader && uploader.uploadLiveCommentAction) {
      uploader.uploadLiveCommentAction(logEntry);
    }
  }

  function getRoomNameFromText(comment) {
    var text = String(comment && (comment.raw || comment.text || "") || "");
    var match = text.match(/直播间[:：]\s*([^\n ]{1,80})/);
    return match ? match[1] : "";
  }

  function maybeExecutePlannedAction(sampleIndex, triggerEvent, action) {
    var liveCommentConfig = config.task.liveComment || {};
    var floatyApproved = !!(context.floatyControl && context.floatyControl.state && context.floatyControl.state.liveCommentExecutionEnabled);
    var botConfig = config.task.liveCommentBotConfig || {};
    var targetRoom = botConfig.targetRoom || {};
    var targetSendAllowed = targetRoom.enabled === true && targetRoom.allowRealSend === true && withinTargetRoomSendLimit(targetRoom);
    if (!targetSendAllowed && (!liveCommentConfig.executeEnabled || liveCommentConfig.manualExecutionApproved !== true || !floatyApproved || !action || action.status !== "planned")) {
      if (action && action.status === "planned") {
        logger.info("直播评论计划仅记录，不执行真实发送", {
          triggerEventId: action.triggerEventId,
          executeEnabled: !!liveCommentConfig.executeEnabled,
          manualExecutionApproved: liveCommentConfig.manualExecutionApproved === true,
          floatyApproved: floatyApproved,
          targetRoomEnabled: targetRoom.enabled === true,
          targetRoomAllowRealSend: targetRoom.allowRealSend === true,
          targetSendAllowed: targetSendAllowed
        });
      }
      return;
    }
    if (!action || action.status !== "planned") {
      return;
    }
    if (!douyin || !douyin.sendLiveComment) {
      action.status = "failed";
      action.failureReason = "send_adapter_missing";
      actionPlanner.recordResult(action, false, action.failureReason);
      logLiveCommentAction("live_comment_result", sampleIndex, triggerEvent, action);
      return;
    }
    if (action.plannedDelayMs && !sleepMs(action.plannedDelayMs)) {
      return;
    }
    if (isControlStopped() || isTargetRoomRefreshRequested()) {
      return;
    }
    var result = douyin.sendLiveComment(action.replyText, {
      commentMode: config.task.liveCommentMode,
      actionType: action.type || ""
    });
    if (result && result.success) {
      action.status = "sent";
      action.sentAt = result.sentAt || nowIso();
      actionPlanner.recordResult(action, true, "");
      if (targetRoom.enabled === true) {
        targetRoomSendState.sentCount += 1;
        targetRoomSendState.lastSentAt = Date.now();
      }
    } else {
      action.status = "failed";
      action.failureReason = (result && result.failureReason) || "send_failed";
      actionPlanner.recordResult(action, false, action.failureReason);
    }
    logLiveCommentAction("live_comment_result", sampleIndex, triggerEvent, action);
  }

  function normalizeTargetList(value) {
    var result = [];
    value = value || [];
    for (var i = 0; i < value.length; i++) {
      var item = String(value[i] || "").replace(/\s+/g, " ").trim();
      if (item) {
        result.push(item);
      }
    }
    return result;
  }

  function matchTargetRoom(text, commentsText, roomName, targetRoom) {
    targetRoom = targetRoom || {};
    if (targetRoom.enabled !== true) {
      return { matched: true, reason: "target_room_disabled" };
    }
    var source = String([text || "", commentsText || "", roomName || ""].join(" "));
    var keywords = [];
    var anchorName = String(targetRoom.anchorName || "").replace(/\s+/g, " ").trim();
    if (anchorName) {
      keywords.push(anchorName);
    }
    keywords = keywords.concat(normalizeTargetList(targetRoom.titleKeywords));
    keywords = keywords.concat(normalizeTargetList(targetRoom.roomKeywords));
    if (!keywords.length) {
      return { matched: false, reason: "target_room_empty_rule" };
    }
    for (var i = 0; i < keywords.length; i++) {
      if (source.indexOf(keywords[i]) >= 0) {
        return { matched: true, reason: "matched:" + keywords[i] };
      }
    }
    if (isRecentTargetLiveRoomEntry(targetRoom)) {
      return { matched: true, reason: "entered_by_target_search" };
    }
    return { matched: false, reason: "target_room_keyword_not_found" };
  }

  function isRecentTargetLiveRoomEntry(targetRoom) {
    var entry = context.targetLiveRoomEntry || null;
    if (!entry || !entry.enteredAt || Date.now() - entry.enteredAt > 30 * 60 * 1000) {
      return false;
    }
    var anchorName = String(targetRoom.anchorName || "").replace(/\s+/g, " ").trim();
    if (anchorName && entry.anchorName && String(entry.anchorName) === anchorName) {
      return true;
    }
    var keywords = [];
    keywords = keywords.concat(normalizeTargetList(targetRoom.titleKeywords));
    keywords = keywords.concat(normalizeTargetList(targetRoom.roomKeywords));
    var entryText = String([
      entry.keyword || "",
      entry.anchorName || "",
      (entry.titleKeywords || []).join(" "),
      (entry.roomKeywords || []).join(" ")
    ].join(" "));
    for (var i = 0; i < keywords.length; i++) {
      if (keywords[i] && entryText.indexOf(keywords[i]) >= 0) {
        return true;
      }
    }
    return !anchorName && keywords.length === 0 && !!entry.keyword;
  }

  function withinTargetRoomSendLimit(targetRoom) {
    var maxSendCount = Math.max(1, Number(targetRoom.maxSendCount || 3));
    var minIntervalMs = Math.max(10, Number(targetRoom.minSendIntervalSeconds || 30)) * 1000;
    if (targetRoomSendState.sentCount >= maxSendCount) {
      return false;
    }
    if (targetRoomSendState.lastSentAt && Date.now() - targetRoomSendState.lastSentAt < minIntervalMs) {
      return false;
    }
    return true;
  }

  function sampleOnce(index) {
    var screen = captureText();
    var text = screen.text || "";
    var currentPackageName = screen.currentPackageName || getCurrentPackageName();
    var state = detector.detect(text, {
      currentPackageName: currentPackageName
    });
    var comments = state.readyForCommentRead ? reader.readFromText(text) : [];
    var classifiedComments = classifier ? classifier.classifyMany(comments) : [];
    var actionPlan = planCommentActions(comments, index);
    var botPlan = planAgriChatbotAction(text, comments, index);
    var triggerEvents = actionPlan.triggerEvents.concat(botPlan.triggerEvents || []);
    var plannedActions = actionPlan.plannedActions.concat(botPlan.plannedActions || []);
    var result = {
      index: index,
      sampledAt: nowIso(),
      currentPackageName: currentPackageName,
      screenScene: screen.scene || "",
      screenSceneReasons: screen.sceneReasons || [],
      state: state.state,
      readyForCommentRead: state.readyForCommentRead,
      reasons: state.reasons,
      commentCount: comments.length,
      cachedCommentCount: commentCache ? commentCache.size() : comments.length,
      addedCommentCount: actionPlan.addedComments.length,
      triggerEventCount: triggerEvents.length,
      plannedActionCount: plannedActions.length,
      comments: comments,
      classifiedComments: classifiedComments,
      triggerEvents: triggerEvents,
      plannedActions: plannedActions,
      roomRelevance: botPlan.roomRelevance,
      p3Actions: [],
      textSample: text.slice(0, 300)
    };
    if (p3ExtensionActions && p3ExtensionActions.planFromLiveSample) {
      result.p3Actions = p3ExtensionActions.planFromLiveSample(result);
    }
    logger.info("直播间只读采样", {
      index: result.index,
      state: result.state,
      readyForCommentRead: result.readyForCommentRead,
      commentCount: result.commentCount,
      cachedCommentCount: result.cachedCommentCount,
      triggerEventCount: result.triggerEventCount,
      plannedActionCount: result.plannedActionCount,
      comments: result.comments.slice(0, 8),
      classifiedComments: result.classifiedComments.slice(0, 8),
      plannedActions: result.plannedActions.slice(0, 5),
      roomRelevance: result.roomRelevance,
      p3Actions: result.p3Actions.slice(0, 5),
      textSample: result.textSample
    });
    return result;
  }

  function sampleCurrentRoom(options) {
    options = options || {};
    if (config.task.liveReadonlyEnabled === false) {
      logger.info("直播间只读采样已关闭");
      return {
        enabled: false,
        sampleCount: 0,
        lastState: "",
        comments: []
      };
    }

    var maxSamples = Number(options.maxSamples || config.task.liveReadonlySampleCount || 8);
    var intervalMs = Number(options.sampleIntervalMs || config.task.liveReadonlySampleIntervalMs || 1200);
    var maxComments = Number(options.maxComments || config.task.liveReadonlyMaxComments || 30);
    var shouldStop = options.shouldStop || function () { return false; };
    var samples = [];
    var allComments = [];
    var classifiedComments = [];
    var allTriggerEvents = [];
    var allPlannedActions = [];
    var allP3Actions = [];
    var stopReason = "";

    logger.info("直播间只读采样启动", {
      maxSamples: maxSamples,
      intervalMs: intervalMs,
      maxComments: maxComments
    });

    for (var i = 0; i < maxSamples; i++) {
      if (shouldStop()) {
        logger.warn("直播间只读采样被停止请求打断", { sampleIndex: i + 1 });
        stopReason = "external_stop";
        break;
      }

      if (isTargetRoomRefreshRequested()) {
        stopReason = "target_room_refresh_requested";
        break;
      }
      waitWhilePaused();
      if (shouldStop() || isControlStopped()) {
        stopReason = "external_stop";
        break;
      }
      if (isTargetRoomRefreshRequested()) {
        stopReason = "target_room_refresh_requested";
        break;
      }

      var result = sampleOnce(i + 1);
      samples.push(result);
      allComments = uniqueByText(allComments.concat(result.comments || [])).slice(0, maxComments);
      classifiedComments = classifier ? classifier.classifyMany(allComments) : [];
      allTriggerEvents = allTriggerEvents.concat(result.triggerEvents || []);
      allPlannedActions = allPlannedActions.concat(result.plannedActions || []);
      allP3Actions = allP3Actions.concat(result.p3Actions || []);

      if (result.currentPackageName && result.currentPackageName !== expectedPackage) {
        logger.warn("直播间只读采样停止：抖音不在前台", {
          currentPackageName: result.currentPackageName
        });
        stopReason = "outside_douyin";
        break;
      }
      if (result.state === "blocked") {
        logger.warn("直播间只读采样停止：检测到阻断状态", {
          reasons: result.reasons
        });
        stopReason = "blocked";
        break;
      }

      if (actionPlanner && actionPlanner.shouldStopForFailures && actionPlanner.shouldStopForFailures()) {
        logger.warn("直播评论连续失败达到上限，停止本轮直播间采样", {
          actionPlannerState: actionPlanner.getState ? actionPlanner.getState() : null
        });
        stopReason = "consecutive_comment_failures";
        break;
      }

      if (!sleepMs(intervalMs)) {
        stopReason = isTargetRoomRefreshRequested() ? "target_room_refresh_requested" : "external_stop";
        break;
      }
    }

    var lastState = samples.length ? samples[samples.length - 1].state : "";
    var actionSummary = summarizeActions(allPlannedActions);
    var payload = {
      enabled: true,
      sampleCount: samples.length,
      lastState: lastState,
      stopReason: stopReason,
      commentCount: allComments.length,
      cachedCommentCount: commentCache ? commentCache.size() : allComments.length,
      triggerEventCount: allTriggerEvents.length,
      plannedActionCount: allPlannedActions.length,
      sentActionCount: actionSummary.sent,
      failedActionCount: actionSummary.failed,
      skippedActionCount: actionSummary.skipped,
      comments: allComments,
      classifiedComments: classifiedComments,
      triggerEvents: allTriggerEvents,
      plannedActions: allPlannedActions,
      p3Actions: allP3Actions,
      actionPlannerState: actionPlanner && actionPlanner.getState ? actionPlanner.getState() : null,
      samples: samples.map(function (item) {
        return {
          index: item.index,
          sampledAt: item.sampledAt,
          screenScene: item.screenScene,
          screenSceneReasons: item.screenSceneReasons,
          state: item.state,
          readyForCommentRead: item.readyForCommentRead,
          commentCount: item.commentCount,
          cachedCommentCount: item.cachedCommentCount,
          triggerEventCount: item.triggerEventCount,
          plannedActionCount: item.plannedActionCount,
          comments: (item.comments || []).slice(0, 8),
          classifiedComments: (item.classifiedComments || []).slice(0, 8),
          plannedActions: (item.plannedActions || []).slice(0, 5),
          p3Actions: (item.p3Actions || []).slice(0, 5),
          textSample: item.textSample
        };
      })
    };
    logger.info("直播间只读采样完成", {
      sampleCount: payload.sampleCount,
      lastState: payload.lastState,
      commentCount: payload.commentCount,
      cachedCommentCount: payload.cachedCommentCount,
      triggerEventCount: payload.triggerEventCount,
      plannedActionCount: payload.plannedActionCount,
      p3ActionCount: payload.p3Actions.length,
      comments: payload.comments.slice(0, 10),
      classifiedComments: payload.classifiedComments.slice(0, 10),
      actionPlannerState: payload.actionPlannerState
    });
    return payload;
  }

  function summarizeActions(actions) {
    var summary = {
      planned: 0,
      sent: 0,
      failed: 0,
      skipped: 0
    };
    actions = actions || [];
    for (var i = 0; i < actions.length; i++) {
      var status = actions[i] && actions[i].status;
      if (summary.hasOwnProperty(status)) {
        summary[status] += 1;
      }
    }
    return summary;
  }

  return {
    sampleCurrentRoom: sampleCurrentRoom
  };
}

module.exports = {
  createLiveRoomSampler: createLiveRoomSampler
};
