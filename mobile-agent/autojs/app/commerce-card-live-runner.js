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
  var v2State = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function taskConfig() {
    var workflow = effectiveWorkflow();
    if (workflow) {
      return buildCommerceConfigFromEffectiveWorkflow(workflow);
    }
    var liveTarget = pickLiveTarget("commerce_card_live_comment");
    if (liveTarget) {
      return buildCommerceConfigFromLiveTarget(liveTarget, config.task.commerceCardLiveComment || {});
    }
    return config.task.commerceCardLiveComment || {};
  }

  function effectiveWorkflow() {
    var workflow = config.task && config.task.effectiveWorkflow;
    return workflow && Number(workflow.workflowVersion) === 2 ? workflow : null;
  }

  function buildCommerceConfigFromEffectiveWorkflow(workflow) {
    var snapshot = workflow.configSnapshot || {};
    var target = workflow.selectedTarget || snapshot.target || {};
    var runtime = snapshot.runtimeConfig || target.runtimeConfig || {};
    return {
      enabled: true,
      workflowVersion: 2,
      effectiveWorkflow: workflow,
      enabledStages: normalizeList(runtime.enabledStages, ["product_nurture"]),
      recommendationSignals: normalizeList(runtime.recommendationSignals, ["你可能还会喜欢"]),
      productCardDwellSeconds: pickNumber(runtime.productCardDwellSeconds, 120),
      productNurtureRoundMinutes: pickNumber(runtime.productNurtureRoundMinutes, 15),
      productNurtureMaxRounds: pickNumber(runtime.productNurtureMaxRounds, 3),
      targetLiveMaxRoomsPerRefresh: pickNumber(runtime.targetLiveMaxRoomsPerRefresh, 25),
      targetCommentSearchMaxActiveMinutes: pickNumber(runtime.targetCommentSearchMaxActiveMinutes, 60),
      maxCommentsPerRoom: pickNumber(runtime.maxCommentsPerRoom, 1),
      commentPool: normalizeList(runtime.commentPool, []),
      liveNurtureKeywords: normalizeList(runtime.liveNurtureKeywords, []),
      liveNurtureRefreshAfterRooms: pickNumber(runtime.liveNurtureRefreshAfterRooms, 10),
      liveNurtureWatchMinMinutes: pickNumber(runtime.liveNurtureWatchMinMinutes, 10),
      liveNurtureWatchMaxMinutes: pickNumber(runtime.liveNurtureWatchMaxMinutes, 20),
      liveNurtureTotalMinMinutes: pickNumber(runtime.liveNurtureTotalMinMinutes, 70),
      liveNurtureTotalMaxMinutes: pickNumber(runtime.liveNurtureTotalMaxMinutes, 100),
      taskMaxActiveMinutes: pickNumber(runtime.taskMaxActiveMinutes, 240),
      searchKeywords: normalizeList(target.searchKeywords, []),
      matchKeywords: normalizeList(target.productKeywords, []),
      liveSignals: normalizeList(target.liveSignals, []),
      targetRoom: buildTargetRoomFromLiveTarget(target)
    };
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

  function pollControlCommandsFromRunner(force) {
    if (!controlLoop) {
      return;
    }
    if (controlLoop.pollControlCommandsAsync) {
      controlLoop.pollControlCommandsAsync(force === true);
      return;
    }
    if (controlLoop.pollControlCommands) {
      controlLoop.pollControlCommands(force === true);
    }
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

  function cloneValue(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function assignmentRuntime() {
    var workflow = effectiveWorkflow() || {};
    var stored = taskScheduler && taskScheduler.getAssignmentContext
      ? taskScheduler.getAssignmentContext("commerce_card_live_comment")
      : null;
    return {
      assignmentId: stored && stored.assignmentId || workflow.assignmentId || "",
      stateVersion: Number(stored && stored.stateVersion || workflow.stateVersion || 0),
      lastEventSeq: Number(stored && stored.lastEventSeq || workflow.lastEventSeq || 0),
      state: taskScheduler && taskScheduler.getTaskState
        ? String((taskScheduler.getTaskState("commerce_card_live_comment") || {}).status || workflow.state || "RUNNING").toUpperCase()
        : String(workflow.state || "RUNNING").toUpperCase(),
      checkpoint: stored && stored.checkpoint || null
    };
  }

  function applyAssignmentResponse(response) {
    var data = response && response.data || {};
    var assignment = data.assignment || null;
    if (!assignment) {
      return null;
    }
    if (taskScheduler && taskScheduler.updateAssignmentRuntime) {
      taskScheduler.updateAssignmentRuntime(
        "commerce_card_live_comment",
        assignment.status || assignment.state,
        assignment.stateVersion,
        assignment.lastEventSeq
      );
    }
    return assignment;
  }

  function initialV2State(workflow) {
    var runtime = assignmentRuntime();
    var checkpoint = runtime.checkpoint;
    if (checkpoint && checkpoint.checkpointVersion === 2 && checkpoint.assignmentId === workflow.assignmentId) {
      return cloneValue(checkpoint);
    }
    return {
      checkpointVersion: 2,
      assignmentId: workflow.assignmentId,
      configRevision: workflow.configRevision,
      configHash: workflow.configHash,
      snapshotHash: workflow.snapshotHash,
      taskType: "commerce_card_live_comment",
      state: runtime.state,
      stateVersion: runtime.stateVersion,
      stage: workflow.configSnapshot.runtimeConfig.enabledStages[0],
      cycleIndex: 0,
      stateEnteredAt: nowIso(),
      stageActiveElapsedMs: 0,
      taskActiveElapsedMs: 0,
      cardIndex: 0,
      browsedCardFingerprints: [],
      liveScanIndex: 0,
      liveMissCount: 0,
      liveRefreshCount: 0,
      roomKeyVersion: 1,
      currentRoomKey: "",
      targetFingerprint: "",
      commentActionsByRoom: {},
      plannedWatchMs: 0,
      completedWatchMs: 0,
      remainingWatchMs: 0,
      pendingSideEffect: null,
      expectedAccountId: workflow.expectedAccount.accountId || "",
      pageSignature: "",
      checkpointSequence: 0,
      checkpointHash: "",
      updatedAt: nowIso()
    };
  }

  function syncV2RuntimeFields() {
    var runtime = assignmentRuntime();
    v2State.state = runtime.state;
    v2State.stateVersion = runtime.stateVersion;
    v2State.updatedAt = nowIso();
  }

  function persistV2Checkpoint(stage, progress) {
    var workflow = effectiveWorkflow();
    if (!workflow || !v2State) {
      return false;
    }
    syncV2RuntimeFields();
    v2State.stage = stage || v2State.stage;
    var previousSequence = Number(v2State.checkpointSequence || 0);
    v2State.checkpointSequence = previousSequence + 1;
    v2State.updatedAt = nowIso();
    var checkpointForHash = cloneValue(v2State);
    delete checkpointForHash.checkpointHash;
    v2State.checkpointHash = uploader.canonicalSha256(checkpointForHash);
    var stored = taskScheduler && taskScheduler.recordCheckpoint
      ? taskScheduler.recordCheckpoint("commerce_card_live_comment", v2State)
      : null;
    if (!stored) {
      v2State.checkpointSequence = previousSequence;
      setStopReason("checkpoint_write_failed");
      return false;
    }
    var response = uploader.updateAssignmentProgress(workflow.assignmentId, {
      deviceId: config.device.deviceId,
      expectedStateVersion: v2State.stateVersion,
      stage: v2State.stage,
      checkpoint: v2State,
      progress: progress || {
        stage: v2State.stage,
        cycleIndex: v2State.cycleIndex,
        cardIndex: v2State.cardIndex,
        liveScanIndex: v2State.liveScanIndex,
        completedWatchMs: v2State.completedWatchMs
      }
    });
    if (!response || !response.success) {
      v2State.checkpointSequence = previousSequence;
      v2State.updatedAt = nowIso();
      var rollbackHashInput = cloneValue(v2State);
      delete rollbackHashInput.checkpointHash;
      v2State.checkpointHash = uploader.canonicalSha256(rollbackHashInput);
      taskScheduler.recordCheckpoint("commerce_card_live_comment", v2State);
      setStopReason(response && response.errorCode || "checkpoint_upload_failed");
      return false;
    }
    applyAssignmentResponse(response);
    return true;
  }

  function reportV2Event(eventType, status, options) {
    options = options || {};
    var workflow = effectiveWorkflow();
    var runtime = assignmentRuntime();
    if (!workflow || !runtime.assignmentId) {
      return false;
    }
    var nextState = options.toState || runtime.state;
    var response = uploader.reportAssignmentEvent(runtime.assignmentId, {
      deviceId: config.device.deviceId,
      sequence: runtime.lastEventSeq + 1,
      idempotencyKey: "assignment:" + runtime.assignmentId + ":mobile-event:" + (runtime.lastEventSeq + 1),
      expectedStateVersion: runtime.stateVersion,
      eventType: eventType,
      stage: options.stage || v2State && v2State.stage || null,
      fromState: runtime.state,
      toState: nextState,
      status: status,
      reasonCode: options.reasonCode || null,
      retryable: options.retryable === true,
      recoveryAction: options.recoveryAction || null,
      evidence: options.evidence || {},
      occurredAt: nowIso()
    });
    if (!response || !response.success) {
      setStopReason(response && response.errorCode || "assignment_event_upload_failed");
      return false;
    }
    applyAssignmentResponse(response);
    syncV2RuntimeFields();
    return true;
  }

  function completeV2Assignment(state, reason, progress) {
    var runtime = assignmentRuntime();
    if (!runtime.assignmentId) {
      return false;
    }
    var response = uploader.completeAssignment(runtime.assignmentId, {
      deviceId: config.device.deviceId,
      expectedStateVersion: runtime.stateVersion,
      state: state,
      terminalReason: reason,
      finalProgress: progress || {},
      occurredAt: nowIso()
    });
    if (!response || !response.success) {
      setStopReason(response && response.errorCode || "assignment_complete_failed");
      return false;
    }
    applyAssignmentResponse(response);
    return true;
  }

  function setV2Stage(stage) {
    if (!v2State) {
      return;
    }
    if (v2State.stage !== stage) {
      v2State.stage = stage;
      v2State.cycleIndex = 0;
      v2State.stateEnteredAt = nowIso();
    }
  }

  function stableTargetRoomKey(workflow, searchResult) {
    if (searchResult && searchResult.roomKey) {
      return String(searchResult.roomKey).replace(/\s+/g, " ").trim().toLowerCase();
    }
    var target = workflow && workflow.selectedTarget || {};
    var code = String(target.targetCode || "").replace(/\s+/g, " ").trim().toLowerCase();
    return code ? "target:" + code : "";
  }

  function commentIdempotencyKey(workflow, roomKey, slot) {
    return "cc:" + uploader.canonicalSha256({
      assignmentId: workflow.assignmentId,
      targetId: workflow.selectedTarget.targetId,
      expectedAccountId: workflow.expectedAccount.accountId,
      roomKeyVersion: 1,
      roomKey: roomKey,
      commentSlot: slot
    });
  }

  function currentDouyinAccount() {
    try {
      if (douyin.readCurrentAccountName) {
        var result = douyin.readCurrentAccountName({ restoreFeed: false, allowOpenApp: false });
        if (result && result.success && (result.accountId || result.accountName)) {
          return {
            accountId: result.accountId ? String(result.accountId).trim() : null,
            accountName: result.accountName ? String(result.accountName).replace(/\s+/g, " ").trim() : ""
          };
        }
      }
    } catch (error) {
      report("WARN", "商品卡任务读取当前抖音账号失败", { message: String(error) });
    }
    return { accountId: null, accountName: "" };
  }

  function normalizedAccountName(accountName) {
    return String(accountName || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function accountIdentityForWorkflow(workflow, account) {
    var expected = workflow && workflow.expectedAccount || {};
    var expectedIdentity = String(expected.accountId || "").trim();
    if (expectedIdentity.indexOf("name:") === 0) {
      var accountName = normalizedAccountName(account && account.accountName);
      return accountName ? "name:" + accountName : "";
    }
    if (expectedIdentity) {
      return String(account && account.accountId || "").trim();
    }
    var fallbackName = normalizedAccountName(account && account.accountName);
    return fallbackName ? "name:" + fallbackName : "";
  }

  function accountMatchesWorkflow(workflow, account) {
    var expected = workflow && workflow.expectedAccount || {};
    var expectedIdentity = String(expected.accountId || "").trim();
    var actualIdentity = accountIdentityForWorkflow(workflow, account);
    if (expectedIdentity && actualIdentity !== expectedIdentity) {
      return false;
    }
    var expectedName = normalizedAccountName(expected.accountName);
    return !expectedName || expectedName === normalizedAccountName(account && account.accountName);
  }

  function accountRequestPayload(workflow, account) {
    var expectedIdentity = String(workflow && workflow.expectedAccount && workflow.expectedAccount.accountId || "");
    return {
      accountId: expectedIdentity.indexOf("name:") === 0 ? null : account.accountId,
      accountName: account.accountName || null
    };
  }

  function isCommentPermitUsable(expiresAt) {
    var expiresAtMs = new Date(expiresAt || "").getTime();
    return !isNaN(expiresAtMs) && expiresAtMs - Date.now() > 3000;
  }

  function commerceProductLiveWatchSeconds(cfg) {
    var dwellSeconds = Math.max(1, pickNumber(cfg && cfg.productCardDwellSeconds, 120));
    return Math.max(1, Math.min(dwellSeconds, pickNumber(cfg && cfg.productLiveWatchSeconds, dwellSeconds)));
  }

  function isCurrentLiveRoomVisible() {
    try {
      return !!(douyin.isLiveRoomVisible && douyin.isLiveRoomVisible());
    } catch (error) {
      report("WARN", "商品卡评论发送前直播页复检失败", { message: String(error) });
      return false;
    }
  }

  function markCommentNotSent(workflow, action, roomKey, slot, commentHash, reason, evidence) {
    var failed = updateV2CommentAction(workflow, action, "failed", "", reason, evidence || {});
    if (!failed.success) {
      setStopReason(failed.response && failed.response.errorCode || "comment_fail_closed_report_failed");
      return {
        success: false,
        unknown: true,
        failureReason: counters.lastStopReason
      };
    }
    action = failed.action;
    v2State.commentActionsByRoom[roomKey + "#" + slot] = {
      roomKey: roomKey,
      slot: slot,
      actionId: action.id,
      commentHash: commentHash,
      actionState: action.actionState
    };
    v2State.pendingSideEffect = null;
    persistV2Checkpoint("target_comment", { actionId: action.id, actionState: action.actionState, reason: reason });
    return {
      success: false,
      paused: counters.lastStopReason === "manual_pause",
      cancelled: counters.lastStopReason === "manual_stop" || counters.lastStopReason === "backend_close",
      failureReason: reason
    };
  }

  function blockRecoveredCommentAction(workflow, action, roomKey, slot, commentHash) {
    var blockedAction = action;
    if (action.actionState === "submitting" || action.actionState === "submitted") {
      var unknown = updateV2CommentAction(
        workflow,
        action,
        "unknown",
        "",
        "comment_state_recovered_before_send",
        { recovery: true }
      );
      if (!unknown.success) {
        setStopReason(unknown.response && unknown.response.errorCode || "comment_recovery_mark_unknown_failed");
        return { success: false, unknown: true, failureReason: counters.lastStopReason };
      }
      blockedAction = unknown.action;
    }
    v2State.commentActionsByRoom[roomKey + "#" + slot] = {
      roomKey: roomKey,
      slot: slot,
      actionId: blockedAction.id,
      commentHash: commentHash,
      actionState: blockedAction.actionState
    };
    v2State.pendingSideEffect = null;
    persistV2Checkpoint("target_comment", {
      actionId: blockedAction.id,
      actionState: blockedAction.actionState,
      recovery: true
    });
    return { success: false, unknown: true, failureReason: "comment_unknown" };
  }

  function updateV2CommentAction(workflow, action, nextState, permitToken, failureReason, evidence) {
    var response = uploader.updateCommerceCardCommentAction(workflow.assignmentId, action.id, {
      deviceId: config.device.deviceId,
      expectedActionStateVersion: action.stateVersion,
      state: nextState,
      permitToken: permitToken || undefined,
      failureReason: failureReason || null,
      evidence: evidence || {},
      occurredAt: nowIso()
    });
    if (!response || !response.success || !response.data || !response.data.action) {
      return { success: false, response: response };
    }
    applyAssignmentResponse(response);
    return { success: true, action: response.data.action };
  }

  function recoverPendingSideEffect(workflow) {
    var pending = v2State && v2State.pendingSideEffect;
    if (!pending) {
      return true;
    }
    var response = uploader.getCommerceCardCommentActionByKey(workflow.assignmentId, pending.idempotencyKey);
    if (!response || !response.success || !response.data) {
      setStopReason("pending_comment_query_failed");
      return false;
    }
    var action = response.data;
    if (action.actionState === "submitting") {
      var unknownResult = updateV2CommentAction(workflow, action, "unknown", "", "process_recovered_after_submitting", {
        recovery: true
      });
      if (!unknownResult.success) {
        setStopReason("pending_comment_mark_unknown_failed");
        return false;
      }
      v2State.pendingSideEffect.lastConfirmedState = "unknown";
      reportV2Event("comment_recovery_blocked", "blocked", {
        toState: "BLOCKED",
        reasonCode: "comment_unknown",
        recoveryAction: "manual_resolve_comment",
        evidence: { actionId: action.id }
      });
      return false;
    }
    if (action.actionState === "submitted" || action.actionState === "unknown") {
      reportV2Event("comment_recovery_blocked", "blocked", {
        toState: "BLOCKED",
        reasonCode: "comment_unknown",
        recoveryAction: "manual_resolve_comment",
        evidence: { actionId: action.id, actionState: action.actionState }
      });
      return false;
    }
    if (action.actionState === "planned") {
      v2State.pendingSideEffect = null;
      return persistV2Checkpoint(v2State.stage, { recoveredActionId: action.id, recoveredActionState: "planned" });
    }
    var actionKey = action.roomKey + "#" + action.commentSlot;
    v2State.commentActionsByRoom[actionKey] = {
      roomKey: action.roomKey,
      slot: action.commentSlot,
      actionId: action.id,
      commentHash: action.commentHash,
      actionState: action.actionState
    };
    v2State.pendingSideEffect = null;
    return persistV2Checkpoint(v2State.stage, { recoveredActionId: action.id, recoveredActionState: action.actionState });
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
    if (!v2State) {
      persistCheckpoint({
        checkpointType: "commerce_card_live_failed",
        reason: reason,
        stage: stage || "commerce_card_live_comment",
        textSample: String(textSample || "").slice(0, 260)
      });
    }
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
    if (!v2State) {
      persistCheckpoint({
        checkpointType: "commerce_card_live_finished",
        reason: reason,
        completedRounds: completedRounds,
        maxRounds: extra.maxRounds || 0
      });
    }
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

  function sendV2Comment(workflow, commentText, roomKey, slot, searchResult) {
    if (!workflow.selectedTarget || !workflow.selectedTarget.targetId || !roomKey) {
      return { success: false, failureReason: "stable_room_key_missing" };
    }
    var actionKey = roomKey + "#" + slot;
    var existing = v2State.commentActionsByRoom[actionKey];
    if (existing && existing.actionState === "sent") {
      return { success: true, skipped: true, failureReason: "comment_action_already_recorded" };
    }
    if (existing && (existing.actionState === "submitting" || existing.actionState === "submitted" || existing.actionState === "unknown")) {
      return { success: false, unknown: true, failureReason: "comment_unknown" };
    }
    if (shouldStop()) {
      return {
        success: false,
        paused: counters.lastStopReason === "manual_pause",
        cancelled: counters.lastStopReason === "manual_stop" || counters.lastStopReason === "backend_close",
        failureReason: counters.lastStopReason
      };
    }
    var account = currentDouyinAccount();
    if (!account.accountId && !account.accountName) {
      return { success: false, failureReason: "current_account_unavailable" };
    }
    if (!accountMatchesWorkflow(workflow, account)) {
      return { success: false, failureReason: "expected_account_mismatch" };
    }
    var initialAccountIdentity = accountIdentityForWorkflow(workflow, account);
    var accountPayload = accountRequestPayload(workflow, account);
    var runtime = assignmentRuntime();
    var normalizedComment = String(commentText || "").replace(/\s+/g, " ").trim();
    var commentHash = uploader.sha256Hex(normalizedComment);
    var idempotencyKey = commentIdempotencyKey(workflow, roomKey, slot);
    var reserve = uploader.reserveCommerceCardCommentAction(workflow.assignmentId, {
      deviceId: config.device.deviceId,
      expectedStateVersion: runtime.stateVersion,
      roomKeyVersion: 1,
      roomKey: roomKey,
      commentSlot: slot,
      commentHash: commentHash,
      replyText: normalizedComment,
      currentAccountId: accountPayload.accountId,
      currentAccountName: accountPayload.accountName,
      idempotencyKey: idempotencyKey
    });
    if (!reserve || !reserve.success || !reserve.data || !reserve.data.action) {
      logCommerceCommentAction("skipped", v2State.cycleIndex, normalizedComment, searchResult, {
        skipReason: reserve && reserve.errorCode || "comment_reserve_failed"
      });
      if (shouldStop()) {
        return {
          success: false,
          paused: counters.lastStopReason === "manual_pause",
          cancelled: counters.lastStopReason === "manual_stop" || counters.lastStopReason === "backend_close",
          failureReason: counters.lastStopReason
        };
      }
      return { success: false, failureReason: reserve && reserve.errorCode || "comment_reserve_failed" };
    }
    applyAssignmentResponse(reserve);
    var action = reserve.data.action;
    var permitToken = reserve.data.permitToken;
    if (action.actionState === "submitting" || action.actionState === "submitted" || action.actionState === "unknown") {
      return blockRecoveredCommentAction(workflow, action, roomKey, slot, commentHash);
    }
    if (!permitToken) {
      v2State.commentActionsByRoom[actionKey] = {
        roomKey: roomKey,
        slot: slot,
        actionId: action.id,
        commentHash: commentHash,
        actionState: action.actionState
      };
      persistV2Checkpoint("target_comment", { actionId: action.id, actionState: action.actionState });
      return { success: action.actionState === "sent", skipped: action.actionState !== "sent", failureReason: "comment_action_not_sendable" };
    }

    v2State.pendingSideEffect = {
      actionId: action.id,
      idempotencyKey: idempotencyKey,
      slot: slot,
      commentHash: commentHash,
      permitExpiresAt: reserve.data.permitExpiresAt,
      lastConfirmedState: "planned"
    };
    if (!persistV2Checkpoint("target_comment", { actionId: action.id, actionState: "planned" })) {
      updateV2CommentAction(workflow, action, "failed", "", "checkpoint_write_failed", {});
      return { success: false, failureReason: "checkpoint_write_failed" };
    }

    var submitting = updateV2CommentAction(workflow, action, "submitting", permitToken, "", {
      roomKey: roomKey,
      commentSlot: slot
    });
    if (!submitting.success) {
      setStopReason(submitting.response && submitting.response.errorCode || "comment_submitting_failed");
      return { success: false, failureReason: counters.lastStopReason };
    }
    action = submitting.action;
    v2State.pendingSideEffect.lastConfirmedState = "submitting";
    if (!persistV2Checkpoint("target_comment", { actionId: action.id, actionState: "submitting" })) {
      return { success: false, failureReason: "checkpoint_write_failed" };
    }

    if (shouldStop()) {
      return markCommentNotSent(
        workflow,
        action,
        roomKey,
        slot,
        commentHash,
        counters.lastStopReason || "control_command_before_send",
        { phase: "before_send", controlInterrupted: true }
      );
    }
    if (!isCommentPermitUsable(reserve.data.permitExpiresAt)) {
      return markCommentNotSent(
        workflow,
        action,
        roomKey,
        slot,
        commentHash,
        "comment_permit_expired_before_send",
        { permitExpiresAt: reserve.data.permitExpiresAt || "" }
      );
    }
    var verifiedAccount = currentDouyinAccount();
    if (!accountMatchesWorkflow(workflow, verifiedAccount) ||
      accountIdentityForWorkflow(workflow, verifiedAccount) !== initialAccountIdentity) {
      return markCommentNotSent(
        workflow,
        action,
        roomKey,
        slot,
        commentHash,
        "current_account_changed_before_send",
        { phase: "before_send" }
      );
    }
    if (!isCurrentLiveRoomVisible()) {
      return markCommentNotSent(
        workflow,
        action,
        roomKey,
        slot,
        commentHash,
        "live_room_not_visible_before_send",
        { phase: "before_send" }
      );
    }
    if (!douyin.sendLiveComment) {
      return markCommentNotSent(
        workflow,
        action,
        roomKey,
        slot,
        commentHash,
        "send_live_comment_missing",
        { phase: "before_send" }
      );
    }

    var sendResult = douyin.sendLiveComment(normalizedComment, {
      commentMode: "commerce_card_live_v2",
      plannedDelayMs: 0,
      allowUnconfiguredReply: true
    }) || {};
    var submitted = updateV2CommentAction(workflow, action, "submitted", permitToken, "", {
      sendResult: {
        success: sendResult.success === true,
        failureReason: sendResult.failureReason || ""
      }
    });
    if (!submitted.success) {
      setStopReason("comment_submitted_report_failed");
      reportV2Event("comment_submit_result_unknown", "blocked", {
        toState: "BLOCKED",
        reasonCode: "comment_unknown",
        recoveryAction: "manual_resolve_comment",
        evidence: { actionId: action.id }
      });
      return { success: false, unknown: true, failureReason: "comment_submitted_report_failed" };
    }
    action = submitted.action;
    v2State.pendingSideEffect.lastConfirmedState = "submitted";
    persistV2Checkpoint("target_comment", { actionId: action.id, actionState: "submitted" });

    var finalState = sendResult.success === true ? "sent" : "unknown";
    var finalized = updateV2CommentAction(
      workflow,
      action,
      finalState,
      "",
      sendResult.failureReason || (finalState === "unknown" ? "send_result_unconfirmed" : ""),
      { roomKey: roomKey, commentSlot: slot }
    );
    if (!finalized.success) {
      setStopReason("comment_final_state_report_failed");
      return { success: false, unknown: true, failureReason: "comment_final_state_report_failed" };
    }
    action = finalized.action;
    v2State.commentActionsByRoom[actionKey] = {
      roomKey: roomKey,
      slot: slot,
      actionId: action.id,
      commentHash: commentHash,
      actionState: action.actionState
    };
    v2State.pendingSideEffect = null;
    persistV2Checkpoint("target_comment", { actionId: action.id, actionState: action.actionState });
    logCommerceCommentAction(action.actionState, v2State.cycleIndex, normalizedComment, searchResult, {
      failureReason: action.failureReason || "",
      sentAt: action.sentAt || ""
    });
    return {
      success: action.actionState === "sent",
      unknown: action.actionState === "unknown",
      failureReason: action.failureReason || ""
    };
  }

  function openV2TargetLiveGate(cfg, workflow, options) {
    options = options || {};
    if (!douyin.openTargetLiveRoomFromLiveFeed) {
      return {
        success: false,
        reason: "target_live_feed_adapter_missing"
      };
    }
    var targetKeyword = pickTargetLiveKeyword(cfg.targetRoom, pickFirst(cfg.searchKeywords, []));
    var maxCandidates = Math.max(1, Number(options.maxCandidates || cfg.targetLiveMaxRoomsPerRefresh || 25));
    var entered = douyin.openTargetLiveRoomFromLiveFeed({
      keyword: targetKeyword,
      targetRoom: cfg.targetRoom,
      maxCandidates: maxCandidates,
      source: options.source || "target_comment",
      restartBeforeScan: options.restartBeforeScan === true,
      enterLiveFeed: options.enterLiveFeed !== false,
      pollControlCommands: pollControlCommandsFromRunner,
      shouldStop: shouldStop
    });
    var lastResult = douyin.getLastTargetLiveSearchResult ? douyin.getLastTargetLiveSearchResult() || {} : {};
    if (!entered) {
      return {
        success: false,
        reason: lastResult.reason || "target_live_room_not_found",
        keyword: targetKeyword,
        matchedKeywords: lastResult.matchedKeywords || lastResult.targetKeywords || [],
        textSample: lastResult.textSample || "",
        targetResult: lastResult
      };
    }
    return normalizeTargetLiveResult(lastResult, {
      keyword: targetKeyword,
      matchedKeywords: lastResult.matchedKeywords || lastResult.targetKeywords || [],
      textSample: lastResult.textSample || "",
      roomKey: lastResult.roomKey || stableTargetRoomKey(workflow, lastResult)
    });
  }

  function runV2ProductNurture(cfg, workflow) {
    if (cfg.enabledStages.indexOf("product_nurture") < 0) {
      return { success: true, skipped: true };
    }
    setV2Stage("product_nurture");
    if (!reportV2Event("stage_product_nurture_started", "started", { stage: "product_nurture" })) {
      return { success: false, reason: counters.lastStopReason };
    }
    var searchKeyword = pickFirst(cfg.searchKeywords, []);
    if (!searchKeyword) {
      return { success: false, reason: "commerce_search_keyword_empty" };
    }
    for (var roundIndex = Number(v2State.cycleIndex || 0) + 1; roundIndex <= cfg.productNurtureMaxRounds; roundIndex++) {
      if (shouldStop()) {
        return { success: false, paused: counters.lastStopReason === "manual_pause", reason: counters.lastStopReason };
      }
      v2State.cycleIndex = roundIndex;
      if (!persistV2Checkpoint("product_nurture", { cycleIndex: roundIndex, action: "before_product_browse" })) {
        return { success: false, reason: counters.lastStopReason };
      }
      var result = douyin.browseCommerceCards({
        searchKeyword: searchKeyword,
        matchKeywords: cfg.matchKeywords,
        liveSignals: cfg.liveSignals,
        recommendationSignals: cfg.recommendationSignals,
        targetRoom: cfg.targetRoom,
        scanMinutes: cfg.productNurtureRoundMinutes,
        cardCount: Math.max(1, Math.min(20, Math.ceil(cfg.productNurtureRoundMinutes * 60 / cfg.productCardDwellSeconds))),
        requireFullScan: true,
        skipLiveCards: true,
        dwellSeconds: cfg.productCardDwellSeconds,
        liveWatchSeconds: commerceProductLiveWatchSeconds(cfg),
        pollControlCommands: pollControlCommandsFromRunner,
        shouldStop: shouldStop
      }) || {};
      if (!result.success) {
        return { success: false, reason: result.reason || "product_nurture_failed" };
      }
      v2State.cardIndex += Number(result.browsedCount || 0);
      v2State.browsedCardFingerprints.push(uploader.sha256Hex(searchKeyword + ":" + roundIndex + ":" + String(result.textSample || "").slice(0, 120)));
      if (v2State.browsedCardFingerprints.length > 200) {
        v2State.browsedCardFingerprints = v2State.browsedCardFingerprints.slice(-200);
      }
      v2State.stageActiveElapsedMs += cfg.productNurtureRoundMinutes * 60 * 1000;
      v2State.taskActiveElapsedMs += cfg.productNurtureRoundMinutes * 60 * 1000;
      if (!persistV2Checkpoint("product_nurture", { cycleIndex: roundIndex, browsedCount: result.browsedCount || 0 })) {
        return { success: false, reason: counters.lastStopReason };
      }
      var gateResult = openV2TargetLiveGate(cfg, workflow, {
        source: "product_nurture",
        restartBeforeScan: true,
        maxCandidates: Math.max(20, Math.min(30, cfg.targetLiveMaxRoomsPerRefresh || 25))
      });
      if (shouldStop()) {
        return { success: false, paused: counters.lastStopReason === "manual_pause", reason: counters.lastStopReason };
      }
      if (gateResult.success) {
        var roomKey = stableTargetRoomKey(workflow, gateResult);
        v2State.currentRoomKey = roomKey;
        v2State.targetFingerprint = uploader.sha256Hex([
          workflow.selectedTarget.targetCode,
          gateResult.roomName || "",
          gateResult.anchorName || "",
          gateResult.textSample || ""
        ].join(":"));
        if (!persistV2Checkpoint("product_nurture", { cycleIndex: roundIndex, action: "target_room_verified", roomKey: roomKey })) {
          return { success: false, reason: counters.lastStopReason };
        }
        reportV2Event("stage_product_nurture_completed", "succeeded", {
          stage: "product_nurture",
          evidence: { cycleIndex: roundIndex, roomKey: roomKey }
        });
        return { success: true, targetGate: gateResult };
      }
      v2State.liveMissCount += 1;
      if (!persistV2Checkpoint("product_nurture", {
        cycleIndex: roundIndex,
        action: "target_room_not_found",
        reason: gateResult.reason || "target_live_room_not_found"
      })) {
        return { success: false, reason: counters.lastStopReason };
      }
      reportV2Event("product_target_not_found_round", "skipped", {
        stage: "product_nurture",
        reasonCode: "product_target_not_found",
        retryable: roundIndex < cfg.productNurtureMaxRounds,
        evidence: {
          cycleIndex: roundIndex,
          maxCandidates: gateResult.targetResult && gateResult.targetResult.maxCandidates || gateResult.maxCandidates || "",
          liveMissCount: v2State.liveMissCount,
          reason: gateResult.reason || "target_live_room_not_found"
        }
      });
      if (roundIndex < cfg.productNurtureMaxRounds) {
        continue;
      }
      reportV2Event("product_target_not_found", "failed", {
        stage: "product_nurture",
        reasonCode: "product_target_not_found",
        evidence: {
          cycleIndex: roundIndex,
          liveMissCount: v2State.liveMissCount,
          reason: gateResult.reason || "target_live_room_not_found"
        }
      });
      return { success: false, reason: "product_target_not_found" };
    }
    reportV2Event("product_target_not_found", "failed", {
      stage: "product_nurture",
      reasonCode: "product_target_not_found",
      evidence: {
        maxRounds: cfg.productNurtureMaxRounds,
        liveMissCount: v2State.liveMissCount
      }
    });
    return { success: false, reason: "product_target_not_found" };
  }

  function runV2TargetComment(cfg, workflow, verifiedGate) {
    if (cfg.enabledStages.indexOf("target_comment") < 0) {
      if (verifiedGate && verifiedGate.success && cfg.enabledStages.indexOf("live_nurture") < 0 && douyin.exitLiveRoom) {
        douyin.exitLiveRoom();
      }
      return { success: true, skipped: true };
    }
    setV2Stage("target_comment");
    if (!reportV2Event("stage_target_comment_started", "started", { stage: "target_comment" })) {
      return { success: false, reason: counters.lastStopReason };
    }
    var searchResult = verifiedGate && verifiedGate.success ? verifiedGate : null;
    if (searchResult) {
      reportV2Event("target_live_room_reused", "succeeded", {
        stage: "target_comment",
        evidence: { source: searchResult.source || "product_nurture", roomKey: searchResult.roomKey || "" }
      });
    }
    var searchStartedAt = Date.now();
    var searchEndAt = searchStartedAt + Math.max(1, cfg.targetCommentSearchMaxActiveMinutes) * 60 * 1000;
    var maxRefreshAttempts = Math.max(1, Math.min(60, Math.ceil(Math.max(1, cfg.targetCommentSearchMaxActiveMinutes) / 2)));
    var refreshAttempt = 0;
    while (!searchResult && refreshAttempt < maxRefreshAttempts && Date.now() < searchEndAt) {
      if (shouldStop()) {
        return { success: false, paused: counters.lastStopReason === "manual_pause", reason: counters.lastStopReason };
      }
      refreshAttempt += 1;
      v2State.liveScanIndex += 1;
      persistV2Checkpoint("target_comment", {
        liveScanIndex: v2State.liveScanIndex,
        refreshAttempt: refreshAttempt,
        action: "before_live_feed_target_gate"
      });
      var gateResult = openV2TargetLiveGate(cfg, workflow, {
        source: "target_comment",
        enterLiveFeed: refreshAttempt === 1 || !douyin.refreshLiveFeedFromHome,
        maxCandidates: cfg.targetLiveMaxRoomsPerRefresh
      });
      if (gateResult.success) {
        searchResult = gateResult;
        break;
      }
      if (shouldStop()) {
        return { success: false, paused: counters.lastStopReason === "manual_pause", reason: counters.lastStopReason };
      }
      v2State.liveMissCount += 1;
      reportV2Event("target_live_room_not_found_refresh", "skipped", {
        stage: "target_comment",
        reasonCode: gateResult.reason || "target_live_room_not_found",
        retryable: refreshAttempt < maxRefreshAttempts,
        evidence: {
          refreshAttempt: refreshAttempt,
          maxRefreshAttempts: maxRefreshAttempts,
          liveMissCount: v2State.liveMissCount
        }
      });
      if (refreshAttempt < maxRefreshAttempts && Date.now() < searchEndAt) {
        v2State.liveRefreshCount += 1;
        persistV2Checkpoint("target_comment", {
          liveScanIndex: v2State.liveScanIndex,
          refreshAttempt: refreshAttempt,
          action: "refresh_live_feed"
        });
        if (douyin.refreshLiveFeedFromHome) {
          douyin.refreshLiveFeedFromHome({ reason: "target_comment_miss" });
        } else if (douyin.enterLiveFeed) {
          douyin.enterLiveFeed();
        }
      }
    }
    if (!searchResult) {
      reportV2Event("target_live_room_not_found", "failed", {
        stage: "target_comment",
        reasonCode: "target_live_room_not_found",
        evidence: { liveMissCount: v2State.liveMissCount, liveRefreshCount: v2State.liveRefreshCount }
      });
      return { success: false, reason: "target_live_room_not_found" };
    }

    var roomKey = stableTargetRoomKey(workflow, searchResult);
    if (!roomKey) {
      return { success: false, reason: "stable_room_key_missing" };
    }
    v2State.currentRoomKey = roomKey;
    v2State.targetFingerprint = uploader.sha256Hex([
      workflow.selectedTarget.targetCode,
      searchResult.roomName || "",
      searchResult.anchorName || ""
    ].join(":"));
    if (!persistV2Checkpoint("target_comment", { roomKey: roomKey, action: "room_verified" })) {
      return { success: false, reason: counters.lastStopReason };
    }
    for (var slot = 0; slot < cfg.maxCommentsPerRoom; slot++) {
      var commentText = cfg.commentPool[slot % cfg.commentPool.length];
      if (!commentText) {
        break;
      }
      var sendResult = sendV2Comment(workflow, commentText, roomKey, slot, searchResult);
      if (sendResult.paused) {
        return { success: false, paused: true, reason: sendResult.failureReason || "manual_pause" };
      }
      if (sendResult.cancelled) {
        return { success: false, cancelled: true, reason: sendResult.failureReason || "backend_close" };
      }
      if (sendResult.unknown) {
        return { success: false, blocked: true, reason: sendResult.failureReason || "comment_unknown" };
      }
      if (!sendResult.success && !sendResult.skipped) {
        return { success: false, reason: sendResult.failureReason || "comment_send_failed" };
      }
    }
    reportV2Event("stage_target_comment_completed", "succeeded", {
      stage: "target_comment",
      evidence: { roomKey: roomKey }
    });
    return { success: true };
  }

  function randomBetween(minimum, maximum) {
    var min = Math.min(minimum, maximum);
    var max = Math.max(minimum, maximum);
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function runV2LiveNurture(cfg) {
    if (cfg.enabledStages.indexOf("live_nurture") < 0) {
      return { success: true, skipped: true };
    }
    setV2Stage("live_nurture");
    if (!reportV2Event("stage_live_nurture_started", "started", { stage: "live_nurture" })) {
      return { success: false, reason: counters.lastStopReason };
    }
    var targetMs = Number(v2State.plannedWatchMs || 0);
    if (targetMs <= 0) {
      var targetMinutes = randomBetween(cfg.liveNurtureTotalMinMinutes, cfg.liveNurtureTotalMaxMinutes);
      targetMs = targetMinutes * 60 * 1000;
      v2State.plannedWatchMs = targetMs;
      v2State.remainingWatchMs = Math.max(0, targetMs - v2State.completedWatchMs);
      if (!persistV2Checkpoint("live_nurture", { action: "watch_target_planned", plannedWatchMs: targetMs })) {
        return { success: false, reason: counters.lastStopReason };
      }
    }
    v2State.remainingWatchMs = Math.max(0, targetMs - v2State.completedWatchMs);
    if (douyin.isLiveRoomVisible && douyin.isLiveRoomVisible() && douyin.exitLiveRoom) {
      douyin.exitLiveRoom();
    }
    if (douyin.enterLiveFeed) {
      douyin.enterLiveFeed();
    }
    var roomIndex = 0;
    var missSinceRefresh = 0;
    while (v2State.completedWatchMs < targetMs && roomIndex < 100) {
      if (shouldStop()) {
        return { success: false, paused: counters.lastStopReason === "manual_pause", reason: counters.lastStopReason };
      }
      roomIndex += 1;
      var visibleText = readVisibleText();
      var keywordMatched = cfg.liveNurtureKeywords.some(function (keyword) {
        return visibleText.indexOf(keyword) >= 0;
      });
      var entered = keywordMatched && douyin.openLiveRoomFromCurrentScreen
        ? douyin.openLiveRoomFromCurrentScreen(visibleText)
        : false;
      if (!entered) {
        missSinceRefresh += 1;
        if (missSinceRefresh >= cfg.liveNurtureRefreshAfterRooms) {
          missSinceRefresh = 0;
          v2State.liveRefreshCount += 1;
          persistV2Checkpoint("live_nurture", {
            roomIndex: roomIndex,
            action: "refresh_live_feed_after_misses",
            liveRefreshCount: v2State.liveRefreshCount
          });
          if (douyin.refreshLiveFeedFromHome) {
            douyin.refreshLiveFeedFromHome({ reason: "live_nurture_miss_limit" });
          } else if (douyin.enterLiveFeed) {
            douyin.enterLiveFeed();
          }
        } else if (douyin.nextVideo) {
          douyin.nextVideo();
        }
        continue;
      }
      missSinceRefresh = 0;
      var watchMinutes = randomBetween(cfg.liveNurtureWatchMinMinutes, cfg.liveNurtureWatchMaxMinutes);
      var watchMs = Math.min(watchMinutes * 60 * 1000, targetMs - v2State.completedWatchMs);
      v2State.remainingWatchMs = Math.max(0, targetMs - v2State.completedWatchMs);
      persistV2Checkpoint("live_nurture", { roomIndex: roomIndex, action: "watch_started", plannedWatchMs: watchMs });
      if (!sleepResponsive(watchMs, "live_nurture_watch")) {
        return { success: false, paused: counters.lastStopReason === "manual_pause", reason: counters.lastStopReason };
      }
      v2State.completedWatchMs += watchMs;
      v2State.remainingWatchMs = Math.max(0, targetMs - v2State.completedWatchMs);
      v2State.taskActiveElapsedMs += watchMs;
      persistV2Checkpoint("live_nurture", { roomIndex: roomIndex, action: "watch_completed", completedWatchMs: v2State.completedWatchMs });
      if (douyin.exitLiveRoom) {
        douyin.exitLiveRoom();
      }
    }
    if (v2State.completedWatchMs < targetMs) {
      persistV2Checkpoint("live_nurture", {
        roomIndex: roomIndex,
        action: "watch_incomplete",
        completedWatchMs: v2State.completedWatchMs,
        plannedWatchMs: targetMs
      });
      reportV2Event("live_nurture_watch_incomplete", "failed", {
        stage: "live_nurture",
        reasonCode: "live_nurture_watch_incomplete",
        evidence: {
          completedWatchMs: v2State.completedWatchMs,
          plannedWatchMs: targetMs,
          roomIndex: roomIndex,
          liveRefreshCount: v2State.liveRefreshCount
        }
      });
      return { success: false, reason: "live_nurture_watch_incomplete" };
    }
    reportV2Event("stage_live_nurture_completed", "succeeded", {
      stage: "live_nurture",
      evidence: { completedWatchMs: v2State.completedWatchMs }
    });
    return { success: true };
  }

  function runCommerceCardWorkflowV2(options) {
    options = options || {};
    var workflow = effectiveWorkflow();
    var cfg = taskConfig();
    if (!workflow || !workflow.assignmentId || !workflow.configSnapshot) {
      return finishFailure("effective_workflow_missing", "commerce_card_v2_precheck", "");
    }
    if (new Date(workflow.expiresAt).getTime() <= Date.now()) {
      completeV2Assignment("EXPIRED", "assignment_expired", {});
      return finishFailure("assignment_expired", "commerce_card_v2_precheck", "");
    }
    v2State = initialV2State(workflow);
    if (!recoverPendingSideEffect(workflow)) {
      return { success: false, blocked: true, reason: counters.lastStopReason || "pending_comment_unresolved" };
    }
    if (!reportV2Event("commerce_card_workflow_started", "started", {
      stage: v2State.stage,
      evidence: { workflowVersion: 2, snapshotHash: workflow.snapshotHash }
    })) {
      return finishFailure(counters.lastStopReason, "commerce_card_v2_start", "");
    }
    var result = runV2ProductNurture(cfg, workflow);
    var productTargetGate = result && result.targetGate || null;
    if (result.success) {
      result = runV2TargetComment(cfg, workflow, productTargetGate);
    }
    if (result.success) {
      result = runV2LiveNurture(cfg);
    }
    if (result.success && shouldStop()) {
      result = {
        success: false,
        paused: counters.lastStopReason === "manual_pause",
        cancelled: counters.lastStopReason === "manual_stop" || counters.lastStopReason === "backend_close",
        reason: counters.lastStopReason
      };
    }
    if (result.paused) {
      persistV2Checkpoint(v2State.stage, { paused: true, reason: result.reason });
      return { success: false, paused: true, reason: result.reason || "manual_pause" };
    }
    if (result.blocked) {
      persistV2Checkpoint(v2State.stage, { blocked: true, reason: result.reason });
      return result;
    }
    if (result.reason === "manual_stop" || result.reason === "backend_close") {
      persistV2Checkpoint(v2State.stage, { cancelled: true, reason: result.reason });
      return { success: false, cancelled: true, reason: result.reason };
    }
    if (!result.success) {
      completeV2Assignment("FAILED", result.reason || "commerce_card_v2_failed", {
        stage: v2State.stage,
        cycleIndex: v2State.cycleIndex
      });
      return finishFailure(result.reason || "commerce_card_v2_failed", v2State.stage, "");
    }
    completeV2Assignment("SUCCEEDED", "commerce_card_workflow_completed", {
      stage: v2State.stage,
      cycleIndex: v2State.cycleIndex,
      completedWatchMs: v2State.completedWatchMs
    });
    return finishSuccess("commerce_card_workflow_completed", v2State.cycleIndex, {
      maxRounds: cfg.productNurtureMaxRounds
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
      roomKey: result.roomKey || fallback.roomKey || "",
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
      dwellSeconds: Math.max(1, pickNumber(cfg.productCardDwellSeconds, 120)),
      liveWatchSeconds: commerceProductLiveWatchSeconds(cfg),
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
    v2State = null;
    var cfg = taskConfig();
    if (cfg.enabled !== true && options.force !== true) {
      return finishFailure("commerce_card_live_disabled", "commerce_card_live_config", "");
    }

    counters.currentPhase = "commerce_card_live_comment";
    counters.phaseStartedAt = nowIso();
    counters.phaseEndedAt = "";
    counters.lastStopReason = "";
    commentedRoomKeys = {};

    if (cfg.workflowVersion === 2) {
      return runCommerceCardWorkflowV2(options);
    }

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
