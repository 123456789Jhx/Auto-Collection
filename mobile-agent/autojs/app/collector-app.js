function createCollectorApp(context) {
  var config = context.config;
  var logger = context.logger;
  var permissions = context.permissions;
  var uploader = context.uploader;
  var floatyControl = context.floatyControl;
  var douyin = context.douyin;
  var counters = context.counters;
  var controlLoop = context.controlLoop;
  var heartbeatService = context.heartbeatService;
  var taskScheduler = context.taskScheduler;
  var phaseRunner = context.phaseRunner;
  var liveCommentRunner = context.liveCommentRunner;

  function randomMinutes(min, max) {
    var low = Math.max(1, Number(min || 1));
    var high = Math.max(low, Number(max || low));
    return low + Math.round(Math.random() * (high - low));
  }

  function pickRandomKeyword() {
    var keywords = config.task.keywords || [];
    if (!keywords.length) {
      return "";
    }
    return keywords[Math.floor(Math.random() * keywords.length)];
  }

  function addTargetKeyword(result, value) {
    value = String(value || "").replace(/\s+/g, " ").trim();
    if (!value) {
      return;
    }
    for (var i = 0; i < result.length; i++) {
      if (result[i] === value) {
        return;
      }
    }
    result.push(value);
  }

  function addTargetKeywordList(result, value) {
    if (typeof value === "string") {
      value = value.split(/[\n,，]/);
    } else {
      value = value || [];
    }
    if (!value.length) {
      return;
    }
    for (var i = 0; i < value.length; i++) {
      addTargetKeyword(result, value[i]);
    }
  }

  function getTargetSearchKeywords(targetRoom) {
    targetRoom = targetRoom || {};
    var result = [];
    addTargetKeywordList(result, targetRoom.searchKeywords);
    if (result.length) {
      return result;
    }
    addTargetKeyword(result, targetRoom.anchorName);
    addTargetKeywordList(result, targetRoom.titleKeywords);
    addTargetKeywordList(result, targetRoom.roomKeywords);
    return result;
  }

  function getTargetMatchKeywords(targetRoom) {
    targetRoom = targetRoom || {};
    var result = [];
    addTargetKeywordList(result, targetRoom.matchKeywords);
    if (result.length) {
      return result;
    }
    addTargetKeywordList(result, targetRoom.searchKeywords);
    if (result.length) {
      return result;
    }
    addTargetKeyword(result, targetRoom.anchorName);
    addTargetKeywordList(result, targetRoom.titleKeywords);
    addTargetKeywordList(result, targetRoom.roomKeywords);
    return result;
  }

  function pickLiveCommentSearchKeyword() {
    var targetRoom = getLiveCommentTargetRoom();
    var keywords = getTargetSearchKeywords(targetRoom);
    if (keywords.length) {
      return keywords[0];
    }
    return pickRandomKeyword();
  }

  function getLiveCommentTargetRoom() {
    var botConfig = config.task.liveCommentBotConfig || {};
    return botConfig.targetRoom || {};
  }

  function shouldEnterTargetLiveRoom() {
    var targetRoom = getLiveCommentTargetRoom();
    return targetRoom.enabled === true && getTargetSearchKeywords(targetRoom).length > 0;
  }

  function isLiveCommentPriorityRequested() {
    return !!context.liveCommentPriorityRequested ||
      !!(floatyControl && floatyControl.state && floatyControl.state.liveCommentControlStatus === "running");
  }

  function tryEnterTargetLiveRoomFromSearch(reason) {
    if (!shouldEnterTargetLiveRoom() || !douyin.openTargetLiveRoomFromSearch) {
      return false;
    }
    var liveKeyword = pickLiveCommentSearchKeyword();
    var targetRoom = getLiveCommentTargetRoom();
    if (douyin.openTargetLiveRoomFromSearch({ keyword: liveKeyword, targetRoom: targetRoom })) {
      var successSearchResult = douyin.getLastTargetLiveSearchResult ? douyin.getLastTargetLiveSearchResult() : {};
      counters.lastSearchKeyword = liveKeyword;
      context.liveCommentTargetRoomRefreshRequested = false;
      context.targetLiveRoomEntry = {
        enteredAt: Date.now(),
        keyword: liveKeyword,
        searchKeywords: getTargetSearchKeywords(targetRoom),
        matchKeywords: getTargetMatchKeywords(targetRoom),
        anchorName: targetRoom.anchorName || ""
      };
      logger.info("live comment: entered target live room from search", {
        reason: reason || "",
        keyword: liveKeyword,
        searchKeywords: getTargetSearchKeywords(targetRoom),
        matchKeywords: getTargetMatchKeywords(targetRoom),
        searchResult: successSearchResult
      });
      controlLoop.reportRuntimeLog("INFO", "live comment: entered target live room from search", {
        phase: "live_comment_target_search",
        reason: reason || "",
        keyword: liveKeyword,
        searchKeywords: getTargetSearchKeywords(targetRoom),
        matchKeywords: getTargetMatchKeywords(targetRoom),
        searchResult: successSearchResult
      });
      return true;
    }
    var searchResult = douyin.getLastTargetLiveSearchResult ? douyin.getLastTargetLiveSearchResult() : {};
    var failureReason = searchResult.reason || "target_live_room_search_failed";
    counters.lastStopReason = failureReason;
    logger.warn("live comment: target live room search failed", {
      reason: reason || "",
      failureReason: failureReason,
      keyword: liveKeyword,
      searchKeywords: getTargetSearchKeywords(targetRoom),
      matchKeywords: getTargetMatchKeywords(targetRoom),
      searchResult: searchResult
    });
    controlLoop.reportRuntimeLog("WARN", "live comment: target live room search failed", {
      phase: "live_comment_target_search",
      reason: reason || "",
      failureReason: failureReason,
      keyword: liveKeyword,
      searchKeywords: getTargetSearchKeywords(targetRoom),
      matchKeywords: getTargetMatchKeywords(targetRoom),
      searchResult: searchResult
    });
    return false;
  }

  context.tryEnterTargetLiveRoomFromSearch = tryEnterTargetLiveRoomFromSearch;
  context.liveCommentTargetRoomRefreshRequested = false;

  function runBackground(name, fn) {
    try {
      if (typeof threads === "undefined" || !threads.start) {
        logger.warn(name + "跳过，当前环境不支持后台线程");
        return false;
      }

      threads.start(function () {
        try {
          fn();
        } catch (error) {
          logger.warn(name + "失败", { message: String(error) });
        }
      });
      return true;
    } catch (error) {
      logger.warn(name + "后台线程启动失败", { message: String(error) });
      return false;
    }
  }

  function currentAgentStatus() {
    if (floatyControl.state.stopRequested) {
      return "stopped";
    }
    if (floatyControl.state.paused) {
      return "paused";
    }
    if (floatyControl.state.running) {
      return "running";
    }
    return "idle";
  }

  function checkAgentVersion(force) {
    if (!config.upload.versionCheckEnabled) {
      return;
    }
    var intervalMs = (config.upload.versionCheckIntervalMinutes || 30) * 60 * 1000;
    var now = Date.now();
    if (!force && context.agentVersion && context.agentVersion.lastCheckAt && now - context.agentVersion.lastCheckAt < intervalMs) {
      return;
    }
    context.agentVersion = context.agentVersion || {};
    context.agentVersion.lastCheckAt = now;

    runBackground("手机 Agent 版本检查", function () {
      var result = uploader.checkAgentVersion();
      if (!result) {
        return;
      }
      context.agentVersion.lastResult = result;
      if (result.updateAvailable && result.latestVersion) {
        var latestVersion = result.latestVersion.version;
        logger.warn("发现手机 Agent 新版本", {
          currentVersion: config.app.version,
          latestVersion: latestVersion,
          forceUpdate: result.forceUpdate
        });
        floatyControl.update({ lastMessage: "发现新版本 " + latestVersion });
        if (!uploader.applyAgentUpdate) {
          logger.warn("agent update skipped: applyAgentUpdate not available", {
            latestVersion: latestVersion,
            forceUpdate: result.forceUpdate
          });
          uploader.uploadAgentUpdateEvent({
            eventType: "SKIPPED",
            fromVersion: config.app.version,
            toVersion: latestVersion,
            message: "applyAgentUpdate not available",
            payload: result
          });
          return;
        }
        try {
          var updateResult = uploader.applyAgentUpdate(result, { scriptDir: config.runtime && config.runtime.scriptDir });
          if (updateResult && updateResult.applied) {
            floatyControl.update({
              running: false,
              paused: true,
              stopRequested: false,
              lastMessage: "更新完成，正在重启"
            });
            logger.info("agent update applied, exiting current engine", updateResult);
            sleep(1000);
            exit();
          }
        } catch (updateError) {
          logger.warn("agent update failed", { message: String(updateError), latestVersion: latestVersion });
          uploader.uploadAgentUpdateEvent({
            eventType: "FAILED",
            fromVersion: config.app.version,
            toVersion: latestVersion,
            message: String(updateError),
            payload: result
          });
        }
      }
    });
  }

  function todayString() {
    var now = new Date();
    var month = now.getMonth() + 1;
    var day = now.getDate();
    return now.getFullYear() + "-" + (month < 10 ? "0" + month : month) + "-" + (day < 10 ? "0" + day : day);
  }

  function maybeUploadDailyLogs() {
    if (!config.upload.enabled || config.upload.dailyLogUploadHour === undefined) {
      return;
    }
    var now = new Date();
    var hour = Number(config.upload.dailyLogUploadHour);
    var minute = Number(config.upload.dailyLogUploadMinute || 0);
    if (now.getHours() < hour || (now.getHours() === hour && now.getMinutes() < minute)) {
      return;
    }
    var today = todayString();
    context.dailyLogUpload = context.dailyLogUpload || {};
    if (context.dailyLogUpload.lastDate === today || context.dailyLogUpload.running) {
      return;
    }
    context.dailyLogUpload.running = true;
    runBackground("每日完整日志上传", function () {
      try {
        var result = uploader.uploadLogFilesByOptions
          ? uploader.uploadLogFilesByOptions({ days: config.upload.logUploadRecentDays || 7 })
          : uploader.uploadRecentLogFiles(config.upload.logUploadRecentDays || 7);
        context.dailyLogUpload.lastDate = today;
        logger.info("每日完整日志上传完成", {
          logDate: today,
          success: !!result.success,
          uploadedCount: result.uploadedCount || 0,
          failedCount: result.failedCount || 0
        });
        controlLoop.reportRuntimeLog(result.success ? "INFO" : "WARN", "每日完整日志上传完成", {
          phase: "log_upload",
          logDate: today,
          success: !!result.success,
          uploadedCount: result.uploadedCount || 0,
          failedCount: result.failedCount || 0,
          message: result.message || ""
        });
      } finally {
        context.dailyLogUpload.running = false;
      }
    });
  }

  function shouldAbortFlow() {
    return !!(floatyControl.state.stopRequested || floatyControl.state.exitRequested);
  }

  function recoverToFeedAfterSearchFailure(reason, keyword, attempt) {
    try {
      logger.warn("搜索入口失败后恢复推荐流", {
        reason: reason,
        keyword: keyword,
        attempt: attempt
      });
      douyin.restartToFeed();
      return true;
    } catch (error) {
      logger.warn("搜索入口失败后恢复推荐流失败", {
        reason: reason,
        keyword: keyword,
        attempt: attempt,
        message: String(error)
      });
      return false;
    }
  }

  function enterSearchFlow(flowStartedAt) {
    var maxAttempts = Math.max(1, Number(config.runtime.searchEntryRetryCount || 3));
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      var keyword = pickRandomKeyword();
      counters.lastSearchKeyword = keyword;
      floatyControl.update({ lastMessage: "搜索: " + keyword });
      logger.info("选择农业搜索词", { keyword: keyword, attempt: attempt, maxAttempts: maxAttempts });
      controlLoop.reportRuntimeLog("INFO", "选择农业搜索词", {
        phase: "search",
        keyword: keyword,
        attempt: attempt,
        maxAttempts: maxAttempts
      });

      var searchOpened = douyin.openSearch(keyword);
      if (shouldAbortFlow()) {
        return false;
      }
      if (!searchOpened) {
        counters.lastStopReason = "search_failed";
        logger.warn("搜索页打开失败，准备重试", { keyword: keyword, attempt: attempt, maxAttempts: maxAttempts });
        controlLoop.reportRuntimeLog("WARN", "搜索页打开失败，准备重试", {
          phase: "search",
          stopReason: counters.lastStopReason,
          keyword: keyword,
          attempt: attempt,
          maxAttempts: maxAttempts
        });
        recoverToFeedAfterSearchFailure(counters.lastStopReason, keyword, attempt);
        continue;
      }

      controlLoop.reportRuntimeLog("INFO", "搜索页已提交，准备进入搜索结果视频", {
        phase: "search",
        keyword: keyword,
        attempt: attempt
      });
      floatyControl.update({ lastMessage: "进入搜索视频" });
      if (!douyin.openFirstVideoFromSearch()) {
        counters.lastStopReason = "search_video_entry_failed";
        logger.warn("搜索结果视频进入失败，准备重试", { keyword: keyword, attempt: attempt, maxAttempts: maxAttempts });
        controlLoop.reportRuntimeLog("WARN", "搜索结果视频进入失败，准备重试", {
          phase: "search",
          stopReason: counters.lastStopReason,
          keyword: keyword,
          attempt: attempt,
          maxAttempts: maxAttempts
        });
        if (shouldAbortFlow()) {
          return false;
        }
        recoverToFeedAfterSearchFailure(counters.lastStopReason, keyword, attempt);
        continue;
      }

      if (shouldAbortFlow()) {
        return false;
      }
      counters.lastStopReason = "";
      logger.info("启动流程：已进入搜索视频", { elapsedMs: Date.now() - flowStartedAt, keyword: keyword, attempt: attempt });
      controlLoop.reportRuntimeLog("INFO", "已进入搜索结果视频播放页", {
        phase: "search",
        keyword: keyword,
        attempt: attempt,
        elapsedMs: Date.now() - flowStartedAt
      });
      return true;
    }

    if (config.runtime.searchFallbackToFeed !== false) {
      counters.lastStopReason = "search_fallback_to_feed";
      logger.warn("搜索入口多次失败，降级推荐流继续", { maxAttempts: maxAttempts });
      controlLoop.reportRuntimeLog("WARN", "搜索入口多次失败，降级推荐流继续", {
        phase: "search",
        stopReason: counters.lastStopReason,
        maxAttempts: maxAttempts
      });
      floatyControl.update({ lastMessage: "搜索失败，降级推荐流" });
      if (recoverToFeedAfterSearchFailure(counters.lastStopReason, counters.lastSearchKeyword || "", maxAttempts + 1)) {
        counters.lastStopReason = "";
        return true;
      }
    }

    counters.lastStopReason = "search_entry_recover_failed";
    logger.error("搜索入口多次失败且恢复失败", { maxAttempts: maxAttempts });
    controlLoop.reportRuntimeLog("ERROR", "搜索入口多次失败且恢复失败", {
      phase: "search",
      stopReason: counters.lastStopReason,
      maxAttempts: maxAttempts
    });
    return false;
  }

  function enterFlow(requestedTaskType) {
    var flowStartedAt = Date.now();
    var normalizedTaskType = taskScheduler ?
      taskScheduler.resolveTaskType(requestedTaskType) :
      requestedTaskType;
    var isLiveCommentTask = taskScheduler ?
      taskScheduler.resolveTaskType(requestedTaskType) === "live_comment" :
      requestedTaskType === "live_comment";
    var isLiveTask = normalizedTaskType === "live";
    floatyControl.update({ lastMessage: "打开抖音" });
    logger.info("启动流程：打开抖音", { elapsedMs: Date.now() - flowStartedAt });
    if (!douyin.openApp()) {
      throw new Error("无法打开抖音");
    }
    if (shouldAbortFlow()) {
      return false;
    }
    logger.info("启动流程：抖音已打开", { elapsedMs: Date.now() - flowStartedAt });

    if (isLiveCommentTask || isLiveCommentPriorityRequested()) {
      logger.info("live comment control requested: defer target room search to independent runner", {
        elapsedMs: Date.now() - flowStartedAt
      });
      controlLoop.reportRuntimeLog("INFO", "直播评论启动流程只打开抖音，目标进房交给独立 runner", {
        phase: "launch_route",
        taskType: "live_comment",
        route: "live_comment_runner",
        elapsedMs: Date.now() - flowStartedAt
      });
      return true;
    }

    if (isLiveCommentTask && config.task.liveCommentDirectTest === true) {
      if (tryEnterTargetLiveRoomFromSearch("direct_test")) {
        return true;
      }
    }

    if (isLiveCommentTask && config.task.liveCommentDirectTest === true) {
      var liveKeyword = pickLiveCommentSearchKeyword();
      if (liveKeyword && douyin.openLiveSearch && douyin.openLiveSearch(liveKeyword)) {
        counters.lastSearchKeyword = liveKeyword;
        logger.info("live comment direct test: opened live search", { keyword: liveKeyword });
        controlLoop.reportRuntimeLog("INFO", "live comment direct test: opened live search", {
          phase: "live_comment_search",
          keyword: liveKeyword
        });
        return true;
      }
    }

    if (isLiveTask) {
      counters.lastStopReason = "";
      floatyControl.update({ lastMessage: "进入直播入口" });
      logger.info("启动流程：直播任务进入直播入口，不走搜索首个视频", {
        elapsedMs: Date.now() - flowStartedAt,
        taskType: normalizedTaskType,
        mode: config.task.mode || ""
      });
      controlLoop.reportRuntimeLog("INFO", "直播任务进入直播入口，不走搜索首个视频", {
        phase: "launch_route",
        taskType: normalizedTaskType,
        route: "live_feed",
        mode: config.task.mode || "",
        elapsedMs: Date.now() - flowStartedAt
      });
      if (!douyin.enterLiveFeed(pickRandomKeyword())) {
        counters.lastStopReason = "live_feed_entry_failed";
        controlLoop.reportRuntimeLog("WARN", "直播入口进入失败", {
          phase: "launch_route",
          taskType: normalizedTaskType,
          stopReason: counters.lastStopReason
        });
        return false;
      }
      if (shouldAbortFlow()) {
        return false;
      }
      return true;
    }

    if (config.task.mode === "search") {
      if (!enterSearchFlow(flowStartedAt)) {
        return false;
      }
    } else {
      floatyControl.update({ lastMessage: "进入推荐流" });
      douyin.enterVideoFeed();
      if (shouldAbortFlow()) {
        return false;
      }
      logger.info("启动流程：已进入推荐流", { elapsedMs: Date.now() - flowStartedAt });
    }
    return true;
  }

  function resetRunCounters() {
    counters.recoverCount = 0;
    counters.invalidContextCount = 0;
    counters.currentPhase = "";
    counters.phaseStartedAt = "";
    counters.phaseEndedAt = "";
    counters.lastStopReason = "";
  }

  function resetLaunchFailureState() {
    context.launchFailureState = context.launchFailureState || {
      consecutiveCount: 0,
      lastReason: "",
      lastAt: ""
    };
    context.launchFailureState.consecutiveCount = 0;
    context.launchFailureState.lastReason = "";
    context.launchFailureState.lastAt = "";
  }

  function handleLaunchFlowAborted(requestedTaskType, reason) {
    context.launchFailureState = context.launchFailureState || {
      consecutiveCount: 0,
      lastReason: "",
      lastAt: ""
    };
    context.launchFailureState.consecutiveCount += 1;
    context.launchFailureState.lastReason = reason || "launch_flow_aborted";
    context.launchFailureState.lastAt = new Date().toISOString();

    var threshold = Math.max(1, Number(config.runtime.launchFailurePauseThreshold || 3));
    var tooManyFailures = context.launchFailureState.consecutiveCount >= threshold;
    var failureReason = reason || "enter_flow_failed";
    var stopReason = tooManyFailures ? "launch_failed_too_many_times" : "launch_flow_aborted";
    var message = tooManyFailures ? "连续启动失败，已暂停待命" : "启动失败，已回到待命";
    var normalizedTaskType = taskScheduler ? taskScheduler.resolveTaskType(requestedTaskType) : requestedTaskType;

    counters.lastStopReason = stopReason;
    if (normalizedTaskType === "live_comment") {
      context.liveCommentPriorityRequested = false;
      context.liveCommentTargetRoomRefreshRequested = false;
    }
    floatyControl.update({
      running: false,
      paused: true,
      stopRequested: false,
      manualOverride: true,
      lastManualAction: stopReason,
      lastMessage: message
    });
    if (normalizedTaskType === "live_comment") {
      floatyControl.update({
        liveCommentControlStatus: "stopped",
        liveCommentExecutionEnabled: false
      });
    }

    logger.warn(message, {
      taskType: requestedTaskType || "",
      stopReason: stopReason,
      failureReason: failureReason,
      failureCount: context.launchFailureState.consecutiveCount,
      threshold: threshold
    });
    controlLoop.reportRuntimeLog("WARN", message, {
      phase: "launch",
      taskType: requestedTaskType || "",
      stopReason: stopReason,
      failureReason: failureReason,
      failureCount: context.launchFailureState.consecutiveCount,
      threshold: threshold
    });
    heartbeatService.reportImmediateHeartbeat("", tooManyFailures ? "error" : "idle", message);
    if (controlLoop.pollControlCommandsAsync) {
      controlLoop.pollControlCommandsAsync(true);
    }
  }

  function mergeObjects(base, extra) {
    var result = {};
    var key;
    base = base || {};
    extra = extra || {};
    for (key in base) {
      if (Object.prototype.hasOwnProperty.call(base, key)) {
        result[key] = base[key];
      }
    }
    for (key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        result[key] = extra[key];
      }
    }
    return result;
  }

  function persistCheckpoint(extra) {
    if (!taskScheduler) {
      return;
    }
    var explicitTaskType = extra && extra.taskType;
    var currentTaskType = taskScheduler.resolveTaskType(explicitTaskType,
      (context.liveCommentPriorityRequested || floatyControl.state.liveCommentControlStatus === "running") ? "live_comment" : counters.currentPhase
    );
    if (!currentTaskType) {
      return;
    }
    taskScheduler.recordCheckpoint(currentTaskType, mergeObjects({
      currentPhase: counters.currentPhase,
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
      phaseEndedAt: counters.phaseEndedAt
    }, extra || {}));
  }

  function startTask(taskType, commandType, meta) {
    if (taskScheduler) {
      taskScheduler.requestTask(taskType, commandType || "START", meta || {});
    }
  }

  function markTaskFinished(taskType, meta) {
    if (taskScheduler) {
      taskScheduler.finishTask(taskType, meta || {});
    }
  }

  function resolveRequestedTaskType() {
    if (context.runRequestResolver && context.runRequestResolver.resolveRequestedTaskType) {
      return context.runRequestResolver.resolveRequestedTaskType();
    }
    if (context.liveCommentPriorityRequested || floatyControl.state.liveCommentControlStatus === "running") {
      return "live_comment";
    }
    if (taskScheduler) {
      var activeTaskType = taskScheduler.getActiveTaskType();
      if (activeTaskType) {
        return activeTaskType;
      }
    }
    return "video";
  }

  function restoreCheckpoint(taskType) {
    if (!taskScheduler || !taskType) {
      return false;
    }
    return taskScheduler.restoreTask(taskType, counters);
  }

  function runLiveCommentTask(todayLiveMinutes) {
    startTask("live_comment", "START", { reason: "run_live_comment_task" });
    context.liveCommentPriorityRequested = true;
    floatyControl.update({
      liveCommentControlStatus: "running",
      liveCommentExecutionEnabled: true,
      lastMessage: "直播评论任务启动"
    });
    counters.plannedVideoMinutes = 0;
    counters.videoRemainingMinutes = 0;
    counters.plannedLiveMinutes = counters.plannedLiveMinutes || todayLiveMinutes || randomMinutes(config.schedule.liveMinutesMin, config.schedule.liveMinutesMax);
    counters.liveElapsedMinutes = counters.liveElapsedMinutes || 0;
    counters.liveRemainingMinutes = Math.max(1, counters.liveRemainingMinutes || counters.plannedLiveMinutes - counters.liveElapsedMinutes || counters.plannedLiveMinutes);
    logger.info("直播评论任务进入独立执行链路", {
      liveRemainingMinutes: counters.liveRemainingMinutes
    });
    controlLoop.reportRuntimeLog("INFO", "直播评论任务进入独立执行链路", {
      phase: "live_comment_task_start",
      liveRemainingMinutes: counters.liveRemainingMinutes
    });
    if (!liveCommentRunner || !liveCommentRunner.runTargetLiveCommentTask) {
      counters.lastStopReason = "live_comment_runner_missing";
      logger.error("直播评论独立 runner 缺失，停止任务");
      controlLoop.reportRuntimeLog("ERROR", "直播评论独立 runner 缺失，停止任务", {
        phase: "live_comment_task_start",
        stopReason: counters.lastStopReason
      });
      return {
        success: false,
        reason: counters.lastStopReason
      };
    }
    var result = liveCommentRunner.runTargetLiveCommentTask({
      targetRoom: getLiveCommentTargetRoom(),
      keyword: pickLiveCommentSearchKeyword(),
      durationMinutes: counters.liveRemainingMinutes
    });
    context.liveCommentPriorityRequested = false;
    context.liveCommentTargetRoomRefreshRequested = false;
    floatyControl.update({
      liveCommentControlStatus: "stopped",
      liveCommentExecutionEnabled: false
    });
    persistCheckpoint({
      taskType: "live_comment",
      checkpointType: result && result.success ? "live_comment_task_end" : "live_comment_task_failed",
      stopReason: counters.lastStopReason,
      result: result || null
    });
    return result;
  }

  function runLiveTask(todayLiveMinutes) {
    startTask("live", "START", { reason: "run_live_task" });
    counters.plannedLiveMinutes = counters.plannedLiveMinutes || todayLiveMinutes || randomMinutes(config.schedule.liveMinutesMin, config.schedule.liveMinutesMax);
    counters.liveElapsedMinutes = counters.liveElapsedMinutes || 0;
    counters.liveRemainingMinutes = Math.max(1, counters.liveRemainingMinutes || counters.plannedLiveMinutes - counters.liveElapsedMinutes || counters.plannedLiveMinutes);
    phaseRunner.runPhase("live", counters.liveRemainingMinutes, {
      taskType: "live"
    });
    persistCheckpoint({
      taskType: "live",
      checkpointType: "phase_end"
    });
  }

  function runVideoTask(todayVideoMinutes) {
    startTask("video", "START", { reason: "run_video_task" });
    counters.plannedVideoMinutes = counters.plannedVideoMinutes || todayVideoMinutes || randomMinutes(config.schedule.videoMinutesMin, config.schedule.videoMinutesMax);
    counters.videoElapsedMinutes = counters.videoElapsedMinutes || 0;
    counters.videoRemainingMinutes = Math.max(1, counters.videoRemainingMinutes || counters.plannedVideoMinutes - counters.videoElapsedMinutes || counters.plannedVideoMinutes);
    phaseRunner.runPhase("video", counters.videoRemainingMinutes, {
      taskType: "video"
    });
    persistCheckpoint({
      taskType: "video",
      checkpointType: "phase_end"
    });
  }

  function runOneTask() {
    resetRunCounters();
    var requestedTaskType = resolveRequestedTaskType();
    restoreCheckpoint(requestedTaskType);
    floatyControl.update({
      running: true,
      paused: false,
      stopRequested: false,
      viewedCount: counters.viewedCount || 0,
      capturedCount: counters.capturedCount || 0,
      lastMessage: "启动任务"
    });
    logger.info("收到开始指令，进入任务流程");
    controlLoop.reportRuntimeLog("INFO", "收到开始指令，进入任务流程", {
      phase: "task_start",
      status: "running",
      requestedTaskType: requestedTaskType,
      pendingTaskTypeSource: context.runRequestResolver && context.runRequestResolver.getLastResolvedSource
        ? context.runRequestResolver.getLastResolvedSource()
        : ""
    });
    startTask(requestedTaskType, "START", { reason: "run_one_task" });
    runBackground("脚本启动任务心跳上报", function () {
      heartbeatService.reportImmediateHeartbeat("", "running", "启动任务");
    });
    controlLoop.refreshRuntimeConfig();
    if (requestedTaskType === "live_comment" && config.task.liveCommentDirectTest === true) {
      floatyControl.update({
        liveCommentControlStatus: "running",
        liveCommentExecutionEnabled: true
      });
    }
    var liveCommentPriority = !!context.liveCommentPriorityRequested ||
      floatyControl.state.liveCommentControlStatus === "running";
    var mustVerifyTargetLiveRoom = (requestedTaskType === "live_comment" || liveCommentPriority ||
      (requestedTaskType === "live_comment" && config.task.liveCommentDirectTest === true)) &&
      shouldEnterTargetLiveRoom();
    var alreadyInLiveRoom = false;
    try {
      alreadyInLiveRoom = requestedTaskType === "live_comment" &&
        !mustVerifyTargetLiveRoom &&
        config.task.liveCommentDirectTest === true &&
        douyin.isForeground && douyin.isForeground() &&
        douyin.isLiveRoomVisible && douyin.isLiveRoomVisible();
    } catch (error) {
      alreadyInLiveRoom = false;
    }
    if (!alreadyInLiveRoom && !enterFlow(requestedTaskType)) {
      logger.warn("启动流程被停止请求打断", {
        stopRequested: floatyControl.state.stopRequested,
        exitRequested: floatyControl.state.exitRequested
      });
      var launchFailureReason = counters.lastStopReason || "enter_flow_failed";
      handleLaunchFlowAborted(requestedTaskType, launchFailureReason);
      persistCheckpoint({
        taskType: requestedTaskType,
        stopReason: counters.lastStopReason,
        launchFailureReason: launchFailureReason,
        checkpointType: "launch_flow_aborted"
      });
      markTaskFinished(taskScheduler ? taskScheduler.getActiveTaskType() : "", {
        reason: counters.lastStopReason,
        status: "failed",
        commandType: "LAUNCH_FAILED"
      });
      return;
    }
    resetLaunchFailureState();

    if (config.schedule.enabled) {
      var todayVideoMinutes = randomMinutes(config.schedule.videoMinutesMin, config.schedule.videoMinutesMax);
      var todayLiveMinutes = randomMinutes(config.schedule.liveMinutesMin, config.schedule.liveMinutesMax);
      if (requestedTaskType === "live_comment") {
        var liveCommentResult = runLiveCommentTask(todayLiveMinutes);
        finishTask({
          status: liveCommentResult && liveCommentResult.success ? "completed" : "failed",
          reason: (liveCommentResult && liveCommentResult.reason) || counters.lastStopReason || "live_comment_finished",
          commandType: liveCommentResult && liveCommentResult.success ? "FINISH" : "FAILED"
        });
        return;
      }
      if (requestedTaskType === "live") {
        runLiveTask(todayLiveMinutes);
        finishTask();
        return;
      }
      if (requestedTaskType === "video") {
        runVideoTask(todayVideoMinutes);
        finishTask();
        return;
      }
    } else {
      startTask("video", "START", { reason: "schedule_disabled" });
      phaseRunner.runPhase("video", 24 * 60, {
        taskType: "video"
      });
      persistCheckpoint({
        taskType: "video",
        checkpointType: "unscheduled_end"
      });
    }

    markTaskFinished(taskScheduler ? taskScheduler.getActiveTaskType() : "", {
      reason: "task_finished"
    });
  }

  function finishTask(meta) {
    meta = meta || {};
    var finishedTaskType = taskScheduler ? taskScheduler.getActiveTaskType() : "";
    var finishReason = meta.reason || "task_finished";
    var finishStatus = meta.status || "completed";
    var finishCommandType = meta.commandType || "FINISH";
    counters.currentPhase = "";
    counters.phaseStartedAt = "";
    counters.phaseEndedAt = "";
    floatyControl.update({
      running: false,
      paused: true,
      stopRequested: !!floatyControl.state.exitRequested,
      manualOverride: true,
      lastManualAction: finishReason,
      lastMessage: finishStatus === "failed" ? "任务失败，待命中：" + finishReason : "任务结束，待命中"
    });
    logger.info("农业视频手机采集脚本结束", counters);
    controlLoop.reportRuntimeLog("INFO", "农业视频手机采集脚本结束", counters);
    if (douyin.exitAppToHome) {
      var exitResult = douyin.exitAppToHome("task_finished");
      controlLoop.reportRuntimeLog(exitResult ? "INFO" : "WARN", "任务结束后退出抖音", {
        phase: "task_finish",
        taskType: finishedTaskType || "",
        exitResult: !!exitResult
      });
    }
    persistCheckpoint({
      taskType: finishedTaskType || counters.currentPhase || "video",
      checkpointType: finishStatus === "failed" ? "task_failed" : "task_finished",
      stopReason: finishReason
    });
    markTaskFinished(taskScheduler ? taskScheduler.getActiveTaskType() : "", {
      reason: finishReason,
      status: finishStatus,
      commandType: finishCommandType
    });
    runBackground("脚本结束心跳上报", function () {
      heartbeatService.reportImmediateHeartbeat(counters.currentPhase, "idle", "任务结束，待命中");
    });
    runBackground("完整日志上传", function () {
      if (uploader.uploadRecentLogFiles) {
        uploader.uploadRecentLogFiles(7);
      } else {
        uploader.uploadLogFile(logger.getLogFile ? logger.getLogFile() : "");
      }
    });
    toast("采集任务结束");
  }

  function shutdownAgent() {
    logger.info("收到本地停止退出请求，准备关闭 Agent");
    floatyControl.update({
      running: false,
      paused: true,
      stopRequested: true,
      lastMessage: "脚本退出"
    });
    runBackground("脚本退出心跳上报", function () {
      heartbeatService.reportImmediateHeartbeat(counters.currentPhase, "stopped", "脚本退出");
    });
    sleep(300);
    floatyControl.close();
    persistCheckpoint({
      taskType: counters.currentPhase || "video",
      checkpointType: "shutdown"
    });
    try {
      exit();
    } catch (error) {
      logger.warn("调用 exit 失败", { message: String(error) });
    }
  }

  function initializeAgent(startupAt) {
    logger.info("农业视频手机采集 Agent 启动", {
      version: config.app.version,
      taskId: config.task.taskId,
      schedule: config.schedule,
      outputDir: config.output.baseDir
    });

    floatyControl.create();
    floatyControl.update({
      lastMessage: "控制台已就绪"
    });
    logger.info("悬浮看板已创建", { elapsedMs: Date.now() - startupAt });

    runBackground("脚本启动日志上报", function () {
      controlLoop.reportRuntimeLog("INFO", "农业视频手机采集 Agent 启动", {
        version: config.app.version,
        taskId: config.task.taskId,
        schedule: config.schedule,
        outputDir: config.output.baseDir
      });
    });
    runBackground("设备 token 注册", function () {
      uploader.registerDeviceToken();
    });

    floatyControl.update({ lastMessage: "检查权限" });
    logger.info("开始权限检查", { elapsedMs: Date.now() - startupAt });
    if (!permissions.ensureAll()) {
      logger.error("权限检查失败，脚本结束");
      floatyControl.update({ lastMessage: "权限检查失败" });
      runBackground("权限失败日志上报", function () {
        controlLoop.reportRuntimeLog("ERROR", "权限检查失败，脚本结束", { stopReason: "permission_failed" });
      });
      return false;
    }
    logger.info("权限检查完成", { elapsedMs: Date.now() - startupAt });

    runBackground("缓存候选记录补传", function () {
      uploader.retryCached();
    });

    if (!permissions.ensureCapturePermission()) {
      logger.error("鎴浘鏉冮檺妫€鏌ュけ璐ワ紝鑴氭湰缁撴潫");
      floatyControl.update({ lastMessage: "鎴浘鏉冮檺妫€鏌ュけ璐?" });
      runBackground("鎴浘鏉冮檺澶辫触鏃ュ織涓婃姤", function () {
        controlLoop.reportRuntimeLog("ERROR", "鎴浘鏉冮檺妫€鏌ュけ璐ワ紝鑴氭湰缁撴潫", { stopReason: "permission_failed" });
      });
      return false;
    }

    var configResult = controlLoop.syncBackendOnce("startup");
    logger.info("Agent 启动配置同步完成", {
      applied: !!configResult.applied,
      autoStart: !!config.schedule.autoStart,
      running: !!floatyControl.state.running,
      paused: !!floatyControl.state.paused,
      manualOverride: !!floatyControl.state.manualOverride,
      lastManualAction: floatyControl.state.lastManualAction || "",
      message: configResult.message
    });

    if (!configResult.success) {
      floatyControl.update({
        running: false,
        paused: true,
        stopRequested: false,
        manualOverride: true,
        lastManualAction: "backend_not_ready",
        lastMessage: "后台未就绪，等待注册"
      });
      runBackground("后台未就绪日志上报", function () {
        controlLoop.reportRuntimeLog("WARN", "后台未就绪，等待注册/配置同步", {
          version: config.app.version,
          taskId: config.task.taskId,
          message: configResult.message || ""
        });
      });
      return true;
    }

    runBackground("脚本就绪日志上报", function () {
      controlLoop.reportRuntimeLog("INFO", "Agent 已就绪", {
        version: config.app.version,
        taskId: config.task.taskId,
        autoStart: !!config.schedule.autoStart,
        elapsedMs: Date.now() - startupAt
      });
    });
    runBackground("脚本就绪心跳上报", function () {
      var status = currentAgentStatus();
      heartbeatService.reportAgentHeartbeat(
        status,
        status === "running" ? "配置允许自启动，准备执行任务" : (status === "paused" ? "保持暂停" : "未执行任务"),
        true
      );
    });

    if (config.schedule.autoStart && !floatyControl.state.manualOverride) {
      floatyControl.update({
        running: true,
        paused: false,
        stopRequested: false,
        lastMessage: "配置允许自启动"
      });
      toast("Agent已启动，自动执行任务");
    } else {
      toast(floatyControl.state.manualOverride ? "Agent已启动，保持人工状态" : "Agent已启动，未执行任务");
      floatyControl.update({
        lastMessage: floatyControl.state.manualOverride ? "保持人工状态" : "未执行任务"
      });
    }
    return true;
  }

  function idleLoop() {
    logger.info("进入 Agent 常驻待命循环");
    while (!floatyControl.state.exitRequested) {
      try {
        controlLoop.pollControlCommandsAsync(false);
        if (floatyControl.state.running && !floatyControl.state.paused && !floatyControl.state.stopRequested) {
          runOneTask();
        } else {
          if (floatyControl.state.stopRequested) {
            floatyControl.update({
              running: false,
              paused: true,
              stopRequested: false,
              lastMessage: "已停止，待命中"
            });
            heartbeatService.reportAgentHeartbeat("idle", "未执行任务", true);
          }
          controlLoop.syncBackendAsync(false, "idle_loop");
          checkAgentVersion(false);
          maybeUploadDailyLogs();
          heartbeatService.reportAgentHeartbeat(currentAgentStatus(), floatyControl.state.lastMessage || "未执行任务", false);
          sleep(Math.min(config.runtime.agentIdleLoopMs || 1000, 300));
        }
      } catch (error) {
        logger.error("Agent 主循环异常", { message: String(error) });
        floatyControl.update({
          running: false,
          paused: true,
          stopRequested: false,
          lastMessage: "Agent异常，待命中"
        });
        runBackground("Agent 异常心跳上报", function () {
          heartbeatService.reportImmediateHeartbeat(counters.currentPhase, "error", "Agent异常，待命中");
        });
        sleep(1000);
      }
    }
    shutdownAgent();
  }

  function main() {
    var startupAt = Date.now();
    if (!initializeAgent(startupAt)) {
      return;
    }
    idleLoop();
  }

  return {
    main: main
  };
}

module.exports = {
  createCollectorApp: createCollectorApp
};
