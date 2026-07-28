function createPhaseRunner(context) {
  var config = context.config;
  var logger = context.logger;
  var matcher = context.matcher;
  var floatyControl = context.floatyControl;
  var douyin = context.douyin;
  var counters = context.counters;
  var livePhaseState = context.livePhaseState;
  var controlLoop = context.controlLoop;
  var heartbeatService = context.heartbeatService;
  var candidateService = context.candidateService;
  var liveScorer = context.liveScorer;
  var liveRoomSampler = context.liveRoomSampler;
  var riskDetector = context.riskDetector;
  var taskScheduler = context.taskScheduler;

  function randomRangeSeconds(minValue, maxValue) {
    var min = minValue;
    var max = maxValue;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function randomQuickCheckSeconds() {
    return randomRangeSeconds(config.task.quickCheckSecondsMin, config.task.quickCheckSecondsMax);
  }

  function randomMatchedStaySeconds() {
    return randomRangeSeconds(config.task.matchedStaySecondsMin, config.task.matchedStaySecondsMax);
  }

  function randomLiveStaySeconds(quality) {
    if (quality === "high") {
      return randomRangeSeconds(config.task.liveHighStaySecondsMin, config.task.liveHighStaySecondsMax);
    }
    if (quality === "normal") {
      return randomRangeSeconds(config.task.liveNormalStaySecondsMin, config.task.liveNormalStaySecondsMax);
    }
    return randomRangeSeconds(config.task.liveLowStaySecondsMin, config.task.liveLowStaySecondsMax);
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function shouldStop() {
    if (floatyControl.state.exitRequested) {
      if (!counters.lastStopReason) {
        counters.lastStopReason = "manual_exit";
      }
      return true;
    }
    if (floatyControl.state.stopRequested) {
      if (!counters.lastStopReason) {
        counters.lastStopReason = "manual_stop";
      }
      return true;
    }
    if (config.schedule.enabled) {
      return false;
    }
    if (counters.viewedCount >= config.task.maxVideos) {
      counters.lastStopReason = "max_videos";
      return true;
    }
    if (counters.capturedCount >= config.task.maxCaptures) {
      counters.lastStopReason = "max_captures";
      return true;
    }
    return false;
  }

  function persistCheckpoint(sceneType, extra) {
    if (!taskScheduler || !sceneType) {
      return;
    }
    var activeTaskType = taskScheduler.getActiveTaskType ? taskScheduler.getActiveTaskType() : "";
    var checkpointTaskType = taskScheduler.resolveTaskType(
      (extra && extra.taskType) || activeTaskType,
      sceneType
    );
    taskScheduler.recordCheckpoint(checkpointTaskType, {
      taskType: checkpointTaskType,
      sceneType: sceneType,
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

  function isLiveCommentPriorityRunning() {
    return !!context.liveCommentPriorityRequested ||
      !!(floatyControl && floatyControl.state && floatyControl.state.liveCommentControlStatus === "running");
  }

  function currentTaskType() {
    return taskScheduler && taskScheduler.getActiveTaskType ? taskScheduler.getActiveTaskType() : "";
  }

  function isLiveCommentFlowActive() {
    return currentTaskType() === "live_comment" || isLiveCommentPriorityRunning();
  }

  function sleepResponsive(totalMs, sceneType, phaseStartMs, phaseEndAt, stepMs) {
    var endAt = Date.now() + Math.max(0, totalMs || 0);
    var chunkMs = Math.max(100, stepMs || 300);
    while (!shouldStop() && Date.now() < endAt) {
      controlLoop.waitWhilePaused();
      if (shouldStop() || Date.now() >= endAt) {
        break;
      }
      controlLoop.pollControlCommandsAsync(false);
      if (sceneType && phaseStartMs) {
        heartbeatService.writeHeartbeat(sceneType, phaseStartMs, phaseEndAt);
      }
      sleep(Math.min(chunkMs, Math.max(0, endAt - Date.now())));
    }
  }

  function ensureDouyinForeground(sceneType, reason) {
    if (!douyin.isForeground || douyin.isForeground()) {
      return true;
    }

    counters.invalidContextCount += 1;
    logger.warn("Skip scan because Douyin is not foreground", {
      sceneType: sceneType || "",
      reason: reason || "",
      invalidContextCount: counters.invalidContextCount
    });
    controlLoop.reportRuntimeLog("WARN", "Skip scan because Douyin is not foreground", {
      phase: "foreground_guard",
      sceneType: sceneType || "",
      reason: reason || "",
      invalidContextCount: counters.invalidContextCount
    });

    if (sceneType === "live") {
      douyin.restartToFeed();
      if (!isLiveCommentFlowActive()) {
        douyin.enterLiveFeed();
      }
    } else {
      douyin.recover(sceneType || "video");
    }
    return false;
  }

  function handleVideo(sceneType, phaseEndAt) {
    controlLoop.waitWhilePaused();
    if (phaseEndAt && Date.now() >= phaseEndAt) {
      counters.lastStopReason = "phase_expired_while_paused";
      persistCheckpoint(sceneType || "video", { checkpointType: "paused_expired" });
      logger.warn("phase expired while paused, restart task on next loop", {
        sceneType: sceneType,
        expectedEndAt: new Date(phaseEndAt).toISOString()
      });
      return;
    }
    if (shouldStop()) {
      return;
    }
    if (!ensureDouyinForeground(sceneType || "video", "handle_video_start")) {
      return;
    }
    douyin.ensurePlayableFeed("handle_video_start");

    var staySeconds = randomQuickCheckSeconds();
    floatyControl.update({
      viewedCount: counters.viewedCount,
      capturedCount: counters.capturedCount,
      lastMessage: "快速识别 " + staySeconds + " 秒"
    });
    sleepResponsive(staySeconds * 1000);
    if (shouldStop()) {
      return;
    }
    if (!ensureDouyinForeground(sceneType || "video", "before_video_ocr")) {
      return;
    }

    var fastStart = Date.now();
    var screenData = douyin.extractFastText();
    screenData.sceneType = sceneType || "video";
    var text = screenData.combinedText || "";
    logger.info("快速文本识别完成", {
      elapsedMs: Date.now() - fastStart,
      detectedScene: screenData.scene || "",
      sceneReasons: screenData.sceneReasons || [],
      currentPackageName: screenData.currentPackageName || "",
      currentActivityName: screenData.currentActivityName || "",
      textLength: text.length,
      textSample: text.slice(0, 120)
    });
    controlLoop.reportRuntimeLog("INFO", "快速文本识别完成", {
      phase: "fast_ocr",
      sceneType: screenData.sceneType,
      detectedScene: screenData.scene || "",
      sceneReasons: screenData.sceneReasons || [],
      currentPackageName: screenData.currentPackageName || "",
      elapsedMs: Date.now() - fastStart,
      textLength: text.length,
      viewedCount: counters.viewedCount,
      liveViewedCount: counters.liveViewedCount,
      capturedCount: counters.capturedCount,
      textSample: text.slice(0, 120)
    });

    if (riskDetector.isInvalidTaskContext(text)) {
      handleInvalidVideoContext(screenData, text);
      return;
    }
    counters.invalidContextCount = 0;

    if (riskDetector.containsRisk(config, text)) {
      stopForRisk("检测到验证码、登录或风控提示，停止任务", screenData.sceneType, text);
      return;
    }

    var matchResult = matcher.evaluate(text);
    var manualCapture = floatyControl.consumeManualCapture();
    var captureAll = config.task.captureMode === "all";
    var liveCandidate = screenData.sceneType === "live" && matchResult.liveMatched && matchResult.matched;
    if (matchResult.matched || manualCapture || captureAll || liveCandidate) {
      collectMatchedVideo(screenData, text, matchResult, manualCapture, captureAll);
    } else {
      logger.info("非农业内容，快速跳过", {
        sceneType: screenData.sceneType,
        textSample: text.slice(0, 120)
      });
      controlLoop.reportRuntimeLog("INFO", "非农业内容，快速跳过", {
        phase: "video_scan",
        sceneType: screenData.sceneType,
        matched: false,
        viewedCount: counters.viewedCount,
        textSample: text.slice(0, 120)
      });
    }

    if (screenData.sceneType === "live") {
      counters.liveViewedCount += 1;
    } else {
      counters.viewedCount += 1;
    }
    floatyControl.update({ viewedCount: counters.viewedCount });

    if (!shouldStop()) {
      if (floatyControl.consumeSkip()) {
        logger.info("处理悬浮窗跳过请求");
      }
      douyin.nextVideo();
    }
    persistCheckpoint(sceneType || "video", {
      checkpointType: "video_step",
      sceneType: screenData.sceneType || sceneType || "video"
    });
  }

  function handleInvalidVideoContext(screenData, text) {
    counters.invalidContextCount += 1;
    logger.warn("当前页面疑似不在采集上下文", {
      invalidContextCount: counters.invalidContextCount,
      sceneType: screenData.sceneType,
      textSample: text.slice(0, 200)
    });
    if (counters.invalidContextCount >= config.runtime.invalidContextRetryCount) {
      logger.warn("连续识别不到采集上下文，重启当前任务", {
        invalidContextRetryCount: config.runtime.invalidContextRetryCount
      });
      counters.invalidContextCount = 0;
      douyin.recover(screenData.sceneType);
    } else {
      douyin.nextVideo();
    }
  }

  function collectMatchedVideo(screenData, text, matchResult, manualCapture, captureAll) {
    logger.info("命中候选内容", {
      manualCapture: manualCapture,
      captureAll: captureAll,
      match: matchResult
    });
    controlLoop.reportRuntimeLog("INFO", "命中候选内容", {
      phase: "candidate_match",
      sceneType: screenData.sceneType,
      manualCapture: manualCapture,
      captureAll: captureAll,
      agricultureHits: matchResult.agricultureHits || [],
      liveHits: matchResult.liveHits || [],
      viewedCount: counters.viewedCount,
      capturedCount: counters.capturedCount
    });
    floatyControl.update({
      lastMessage: matchResult.matched ? "命中: " + matchResult.agricultureHits.join(",") : "调试采集"
    });
    var matchedStaySeconds = randomMatchedStaySeconds();
    logger.info("农业内容命中，延长停留后采集", {
      matchedStaySeconds: matchedStaySeconds,
      agricultureHits: matchResult.agricultureHits
    });
    floatyControl.update({
      lastMessage: "农业命中停留 " + matchedStaySeconds + " 秒"
    });
    sleepResponsive(matchedStaySeconds * 1000);
    if (shouldStop()) {
      return;
    }
    if (!ensureDouyinForeground(screenData.sceneType || "video", "before_full_video_ocr")) {
      return;
    }
    floatyControl.compact("OCR采集中");
    var fullScreenData = douyin.extractScreen();
    floatyControl.expand("OCR完成");
    fullScreenData.sceneType = screenData.sceneType;
    var fullMatchResult = matcher.evaluate(fullScreenData.combinedText || text);
    candidateService.collectCandidate(screenData, matchResult, {
      fullScreenData: fullScreenData,
      fullMatchResult: fullMatchResult,
      collectComments: screenData.sceneType === "video"
    });
  }

  function sleepWithHeartbeat(totalSeconds, sceneType, phaseStartMs, phaseEndAt) {
    sleepResponsive(totalSeconds * 1000, sceneType, phaseStartMs, phaseEndAt, 1000);
  }

  function handleLive(phaseEndAt, phaseStartMs) {
    controlLoop.waitWhilePaused();
    if (phaseEndAt && Date.now() >= phaseEndAt) {
      counters.lastStopReason = "phase_expired_while_paused";
      logger.warn("live phase expired while paused, restart task on next loop", {
        expectedEndAt: new Date(phaseEndAt).toISOString()
      });
      return;
    }
    if (shouldStop()) {
      return;
    }
    if (!ensureDouyinForeground("live", "handle_live_start")) {
      return;
    }
    if (context.liveCommentTargetRoomRefreshRequested && context.tryEnterTargetLiveRoomFromSearch) {
      floatyControl.update({
        lastMessage: "指定直播间已刷新，重新搜索中"
      });
      context.tryEnterTargetLiveRoomFromSearch("target_room_refresh_retry");
      return;
    }

    if (counters.liveRoomEnteredCount >= config.task.liveMaxRoomsPerPhase) {
      if (!livePhaseState.maxRoomsLogged) {
        livePhaseState.maxRoomsLogged = true;
        logger.info("直播间进入数量已达到本阶段上限，剩余时间只保持阶段心跳", {
          liveRoomEnteredCount: counters.liveRoomEnteredCount,
          liveMaxRoomsPerPhase: config.task.liveMaxRoomsPerPhase
        });
      }
      sleepWithHeartbeat(30, "live", phaseStartMs, phaseEndAt);
      persistCheckpoint("live", {
        checkpointType: "live_idle"
      });
      return;
    }

    var fastStart = Date.now();
    var screenData = douyin.extractFastText();
    screenData.sceneType = "live";
    var text = screenData.combinedText || "";
    var matchResult = matcher.evaluate(text);
    var liveScore = liveScorer.scoreLiveCandidate(text, matchResult);
    counters.liveViewedCount += 1;

    logger.info("直播候选扫描完成", {
      elapsedMs: Date.now() - fastStart,
      liveViewedCount: counters.liveViewedCount,
      liveRoomEnteredCount: counters.liveRoomEnteredCount,
      score: liveScore.score,
      detectedScene: screenData.scene || "",
      sceneReasons: screenData.sceneReasons || [],
      currentPackageName: screenData.currentPackageName || "",
      currentActivityName: screenData.currentActivityName || "",
      quality: liveScore.quality,
      shouldEnter: liveScore.shouldEnter,
      agricultureHits: liveScore.agricultureHits,
      liveHits: liveScore.liveHits,
      reasons: liveScore.reasons,
      textSample: text.slice(0, 160)
    });
    controlLoop.reportRuntimeLog("INFO", "直播候选扫描完成", {
      phase: "live_scan",
      sceneType: "live",
      detectedScene: screenData.scene || "",
      sceneReasons: screenData.sceneReasons || [],
      currentPackageName: screenData.currentPackageName || "",
      score: liveScore.score,
      quality: liveScore.quality,
      shouldEnter: liveScore.shouldEnter,
      agricultureHits: liveScore.agricultureHits,
      liveHits: liveScore.liveHits,
      reasons: liveScore.reasons,
      liveViewedCount: counters.liveViewedCount,
      liveRoomEnteredCount: counters.liveRoomEnteredCount,
      textSample: text.slice(0, 160)
    });

    if (riskDetector.isInvalidTaskContext(text)) {
      handleInvalidLiveContext(text);
      return;
    }
    counters.invalidContextCount = 0;

    if (riskDetector.containsRisk(config, text)) {
      stopForRisk("直播阶段检测到验证码、登录或风控提示，停止任务", "live", text);
      return;
    }

    var liveCommentConfig = config.task.liveComment || {};
    var liveCommentExecutionEnabled = !!(context.floatyControl && context.floatyControl.state && context.floatyControl.state.liveCommentExecutionEnabled);
    if (liveCommentConfig.enabled !== false && liveCommentConfig.executeEnabled && liveCommentConfig.manualExecutionApproved === true && !liveCommentExecutionEnabled) {
      logger.info("直播评论计划已生成但等待手机本地人工确认", {
        liveCommentEnabled: liveCommentConfig.enabled !== false,
        executeEnabled: !!liveCommentConfig.executeEnabled,
        manualExecutionApproved: liveCommentConfig.manualExecutionApproved === true,
        floatyApproved: liveCommentExecutionEnabled
      });
      controlLoop.reportRuntimeLog("INFO", "直播评论计划等待本地人工确认", {
        phase: "live_comment_gate",
        liveCommentEnabled: liveCommentConfig.enabled !== false,
        executeEnabled: !!liveCommentConfig.executeEnabled,
        manualExecutionApproved: liveCommentConfig.manualExecutionApproved === true,
        floatyApproved: liveCommentExecutionEnabled
      });
    }

    if (isLiveCommentFlowActive() && douyin.isLiveRoomVisible && douyin.isLiveRoomVisible()) {
      enterAndCollectLiveRoom(screenData, text, matchResult, liveScore, phaseEndAt, phaseStartMs);
      return;
    }

    if (currentTaskType() === "live_comment" && config.task.liveCommentDirectTest === true) {
      logger.info("指定直播间测试：从当前搜索综合页直接尝试进入直播间", {
        score: liveScore.score,
        reasons: liveScore.reasons,
        textSample: text.slice(0, 160)
      });
      enterAndCollectLiveRoom(screenData, text, matchResult, liveScore, phaseEndAt, phaseStartMs);
      return;
    }

    if (!liveScore.shouldEnter) {
      counters.liveRejectedCount += 1;
      logger.info("直播候选未进入", {
        score: liveScore.score,
        minScore: config.task.liveCandidateMinScore,
        rejectedCount: counters.liveRejectedCount,
        reasons: liveScore.reasons
      });
      controlLoop.reportRuntimeLog("INFO", "直播候选未进入", {
        phase: "live_scan",
        score: liveScore.score,
        minScore: config.task.liveCandidateMinScore,
        rejectedCount: counters.liveRejectedCount,
        reasons: liveScore.reasons
      });
      douyin.nextVideo();
      return;
    }

    enterAndCollectLiveRoom(screenData, text, matchResult, liveScore, phaseEndAt, phaseStartMs);
  }

  function handleInvalidLiveContext(text) {
    counters.invalidContextCount += 1;
    logger.warn("直播阶段页面疑似不在采集上下文", {
      invalidContextCount: counters.invalidContextCount,
      textSample: text.slice(0, 200)
    });
    if (counters.invalidContextCount >= config.runtime.invalidContextRetryCount) {
      counters.invalidContextCount = 0;
      douyin.ensureFeedContext("live_invalid_context");
    } else {
      douyin.nextVideo();
    }
  }

  function enterAndCollectLiveRoom(screenData, text, matchResult, liveScore, phaseEndAt, phaseStartMs) {
    counters.liveCandidateCount += 1;
    logger.info("准备进入直播间", {
      candidateIndex: counters.liveCandidateCount,
      nextRoomIndex: counters.liveRoomEnteredCount + 1,
      score: liveScore.score,
      quality: liveScore.quality,
      agricultureHits: liveScore.agricultureHits,
      liveHits: liveScore.liveHits,
      reasons: liveScore.reasons
    });
    controlLoop.reportRuntimeLog("INFO", "准备进入直播间", {
      phase: "live_entry",
      candidateIndex: counters.liveCandidateCount,
      nextRoomIndex: counters.liveRoomEnteredCount + 1,
      score: liveScore.score,
      quality: liveScore.quality,
      agricultureHits: liveScore.agricultureHits,
      liveHits: liveScore.liveHits,
      reasons: liveScore.reasons
    });

    if (!douyin.isLiveRoomVisible() && !douyin.openLiveRoomFromCurrentScreen(text)) {
      logger.warn("直播入口点击失败，跳过候选", {
        score: liveScore.score,
        textSample: text.slice(0, 160)
      });
      controlLoop.reportRuntimeLog("WARN", "直播入口点击失败，跳过候选", {
        phase: "live_entry",
        score: liveScore.score,
        textSample: text.slice(0, 160)
      });
      douyin.nextVideo();
      return;
    }

    if (!douyin.isLiveRoomVisible()) {
      logger.warn("直播入口点击后未进入直播间，跳过候选并恢复视频流", {
        score: liveScore.score,
        textSample: text.slice(0, 160)
      });
      controlLoop.reportRuntimeLog("WARN", "直播入口点击后未进入直播间，跳过候选并恢复视频流", {
        phase: "live_entry",
        score: liveScore.score,
        textSample: text.slice(0, 160)
      });
      douyin.ensureFeedContext("live_entry_not_confirmed");
      douyin.nextVideo();
      return;
    }

    counters.liveRoomEnteredCount += 1;
    persistCheckpoint("live", {
      checkpointType: "live_room_entered",
      liveRoomEnteredCount: counters.liveRoomEnteredCount
    });
    var staySeconds = randomLiveStaySeconds(liveScore.quality);
    if (phaseEndAt) {
      staySeconds = Math.min(staySeconds, Math.max(30, Math.floor((phaseEndAt - Date.now()) / 1000)));
    }
    logger.info("已进入直播间，开始停留", {
      liveRoomEnteredCount: counters.liveRoomEnteredCount,
      liveMaxRoomsPerPhase: config.task.liveMaxRoomsPerPhase,
      score: liveScore.score,
      quality: liveScore.quality,
      plannedStaySeconds: staySeconds
    });
    controlLoop.reportRuntimeLog("INFO", "已进入直播间，开始停留", {
      phase: "live_room",
      liveRoomEnteredCount: counters.liveRoomEnteredCount,
      liveMaxRoomsPerPhase: config.task.liveMaxRoomsPerPhase,
      score: liveScore.score,
      quality: liveScore.quality,
      plannedStaySeconds: staySeconds
    });
    floatyControl.update({
      lastMessage: "直播间停留 " + Math.round(staySeconds / 60) + " 分钟"
    });

    var sampledStaySeconds = 0;
    var liveRoomSample = null;
    if (liveRoomSampler && liveRoomSampler.sampleCurrentRoom) {
      liveRoomSample = liveRoomSampler.sampleCurrentRoom({
        shouldStop: shouldStop
      });
      sampledStaySeconds = Math.ceil(((liveRoomSample && liveRoomSample.sampleCount) || 0) * Number(config.task.liveReadonlySampleIntervalMs || 1200) / 1000);
      logger.info("直播间只读采样完成", {
        sampleCount: liveRoomSample ? liveRoomSample.sampleCount : 0,
        commentCount: liveRoomSample ? liveRoomSample.commentCount : 0,
        lastState: liveRoomSample ? liveRoomSample.lastState : ""
      });
      controlLoop.reportRuntimeLog("INFO", "直播间只读采样完成", {
        phase: "live_readonly",
        sampleCount: liveRoomSample ? liveRoomSample.sampleCount : 0,
        commentCount: liveRoomSample ? liveRoomSample.commentCount : 0,
        lastState: liveRoomSample ? liveRoomSample.lastState : ""
      });
      if (liveRoomSample && liveRoomSample.stopReason === "target_room_refresh_requested") {
        logger.info("target live room refresh requested, re-entering search", {
          sampleCount: liveRoomSample.sampleCount,
          commentCount: liveRoomSample.commentCount
        });
        controlLoop.reportRuntimeLog("INFO", "target live room refresh requested, re-entering search", {
          phase: "live_room_refresh",
          sampleCount: liveRoomSample.sampleCount,
          commentCount: liveRoomSample.commentCount
        });
        floatyControl.update({
          lastMessage: "指定直播间已刷新，重新搜索中"
        });
        if (context.tryEnterTargetLiveRoomFromSearch) {
          context.tryEnterTargetLiveRoomFromSearch("target_room_refresh");
        }
        return;
      }
      if (liveRoomSample && liveRoomSample.stopReason === "consecutive_comment_failures") {
        counters.lastStopReason = "consecutive_comment_failures";
        floatyControl.update({
          stopRequested: true,
          lastMessage: "直播评论连续失败，已停止"
        });
      }
    }

    sleepWithHeartbeat(Math.max(0, staySeconds - sampledStaySeconds), "live", phaseStartMs, phaseEndAt);
    if (shouldStop()) {
      if (!floatyControl.state.exitRequested) {
        douyin.exitLiveRoom();
      }
      return;
    }
    if (!ensureDouyinForeground("live", "before_full_live_ocr")) {
      return;
    }
    floatyControl.compact("直播OCR采集中");
    var fullScreenData = douyin.extractScreen();
    floatyControl.expand("直播OCR完成");
    fullScreenData.sceneType = "live";
    fullScreenData.liveReadonly = liveRoomSample;
    var fullMatchResult = matcher.evaluate(fullScreenData.combinedText || text);
    candidateService.collectCandidate(screenData, matchResult, {
      fullScreenData: fullScreenData,
      fullMatchResult: fullMatchResult,
      collectComments: false,
      liveRoomSample: liveRoomSample
    });
    logger.info("直播间采集完成，准备退出", {
      liveRoomEnteredCount: counters.liveRoomEnteredCount,
      plannedStaySeconds: staySeconds,
      capturedCount: counters.capturedCount
    });
    douyin.exitLiveRoom();

    if (!shouldStop() && Date.now() < phaseEndAt) {
      douyin.nextVideo();
    }
    persistCheckpoint("live", {
      checkpointType: "live_step",
      liveRoomEnteredCount: counters.liveRoomEnteredCount
    });
  }

  function stopForRisk(message, sceneType, text) {
    counters.lastStopReason = "risk_control";
    logger.error(message, {
      stopReason: counters.lastStopReason,
      text: text
    });
    controlLoop.reportRuntimeLog("ERROR", message, {
      stopReason: counters.lastStopReason,
      sceneType: sceneType,
      textSample: text.slice(0, 300)
    });
    floatyControl.update({
      stopRequested: true,
      lastMessage: "检测到风险提示，已停止"
    });
  }

  function runPhase(sceneType, durationMinutes, options) {
    options = options || {};
    var taskType = options.taskType || sceneType;
    counters.currentPhase = sceneType;
    counters.phaseStartedAt = isoNow();
    counters.phaseEndedAt = "";
    counters.lastStopReason = "";
    if (sceneType === "live") {
      livePhaseState.maxRoomsLogged = false;
      counters.liveViewedCount = 0;
      counters.liveRoomEnteredCount = 0;
      counters.liveCandidateCount = 0;
      counters.liveRejectedCount = 0;
      counters.invalidContextCount = 0;
    }

    var endAt = Date.now() + durationMinutes * 60 * 1000;
    var startMs = Date.now();
    context.heartbeat.lastAt = startMs;
    logger.info("开始采集阶段", {
      sceneType: sceneType,
      taskType: taskType,
      durationMinutes: durationMinutes,
      startedAt: counters.phaseStartedAt,
      expectedEndAt: new Date(endAt).toISOString()
    });
    controlLoop.reportRuntimeLog("INFO", "开始采集阶段", {
      phase: "phase_start",
      sceneType: sceneType,
      taskType: taskType,
      durationMinutes: durationMinutes,
      startedAt: counters.phaseStartedAt,
      expectedEndAt: new Date(endAt).toISOString()
    });
    floatyControl.update({
      lastMessage: (sceneType === "live" ? "直播阶段" : "视频阶段") + "开始"
    });

    if (sceneType === "live" && !isLiveCommentFlowActive()) {
      logger.info("直播阶段启动前恢复页面上下文");
      douyin.enterLiveFeed();
    }

    while (!shouldStop() && Date.now() < endAt) {
      try {
        controlLoop.pollControlCommandsAsync(false);
        if (sceneType === "live") {
          handleLive(endAt, startMs);
        } else {
          handleVideo(sceneType, endAt);
        }
        heartbeatService.writeHeartbeat(sceneType, startMs, endAt);
        counters.recoverCount = 0;
        sleepResponsive(config.runtime.loopIntervalMs);
      } catch (error) {
        logger.error("采集阶段异常", { sceneType: sceneType, message: String(error) });
        controlLoop.reportRuntimeLog("ERROR", "采集阶段异常", {
          phase: "phase_loop",
          sceneType: sceneType,
          message: String(error),
          recoverCount: counters.recoverCount
        });
        counters.recoverCount += 1;
        if (counters.recoverCount > config.runtime.recoverRetryCount) {
          logger.error("异常恢复次数超过上限，停止当前阶段");
          counters.lastStopReason = "recover_limit";
          break;
        }
        try {
          douyin.recover(sceneType);
        } catch (recoverError) {
          logger.error("采集上下文恢复失败，尝试降级回推荐流", {
            sceneType: sceneType,
            message: String(recoverError),
            recoverCount: counters.recoverCount
          });
          controlLoop.reportRuntimeLog("ERROR", "采集上下文恢复失败，尝试降级回推荐流", {
            phase: "phase_recover",
            sceneType: sceneType,
            message: String(recoverError),
            recoverCount: counters.recoverCount
          });
          try {
            douyin.restartToFeed();
          } catch (fallbackError) {
            logger.error("推荐流兜底恢复失败", {
              sceneType: sceneType,
              message: String(fallbackError),
              recoverCount: counters.recoverCount
            });
            controlLoop.reportRuntimeLog("ERROR", "推荐流兜底恢复失败", {
              phase: "phase_recover",
              sceneType: sceneType,
              message: String(fallbackError),
              recoverCount: counters.recoverCount
            });
          }
        }
      }
    }

    finishPhase(sceneType, startMs, endAt, taskType);
  }

  function finishPhase(sceneType, startMs, endAt, taskType) {
    if (!counters.lastStopReason) {
      counters.lastStopReason = Date.now() >= endAt ? "duration_finished" : "phase_finished";
    }
    counters.phaseEndedAt = isoNow();
    var elapsedMinutes = Math.round((Date.now() - startMs) / 60000);
    if (sceneType === "video") {
      counters.videoElapsedMinutes = Number(counters.videoElapsedMinutes || 0) + elapsedMinutes;
      counters.videoRemainingMinutes = Math.max(0, Number(counters.plannedVideoMinutes || 0) - counters.videoElapsedMinutes);
    }
    if (sceneType === "live") {
      counters.liveElapsedMinutes = Number(counters.liveElapsedMinutes || 0) + elapsedMinutes;
      counters.liveRemainingMinutes = Math.max(0, Number(counters.plannedLiveMinutes || 0) - counters.liveElapsedMinutes);
    }
    var payload = {
      sceneType: sceneType,
      taskType: taskType || sceneType,
      startedAt: counters.phaseStartedAt,
      endedAt: counters.phaseEndedAt,
      elapsedMinutes: elapsedMinutes,
      stopReason: counters.lastStopReason,
      viewedCount: counters.viewedCount,
      liveViewedCount: counters.liveViewedCount,
      liveRoomEnteredCount: counters.liveRoomEnteredCount,
      liveCandidateCount: counters.liveCandidateCount,
      liveRejectedCount: counters.liveRejectedCount,
      capturedCount: counters.capturedCount
    };
    logger.info("采集阶段结束", payload);
    controlLoop.reportRuntimeLog("INFO", "采集阶段结束", payload);
    persistCheckpoint(taskType || sceneType, {
      checkpointType: "phase_end",
      stopReason: counters.lastStopReason
    });
    floatyControl.update({
      lastMessage: (sceneType === "live" ? "直播阶段" : "视频阶段") + "结束: " + counters.lastStopReason
    });
  }

  return {
    runPhase: runPhase,
    shouldStop: shouldStop
  };
}

module.exports = {
  createPhaseRunner: createPhaseRunner
};
