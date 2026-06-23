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
  var phaseRunner = context.phaseRunner;

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

  function pickLiveCommentSearchKeyword() {
    var botConfig = config.task.liveCommentBotConfig || {};
    var targetRoom = botConfig.targetRoom || {};
    var titleKeywords = targetRoom.titleKeywords || [];
    var roomKeywords = targetRoom.roomKeywords || [];
    if (targetRoom.anchorName) {
      return String(targetRoom.anchorName);
    }
    if (titleKeywords.length > 0) {
      return String(titleKeywords[0]);
    }
    if (roomKeywords.length > 0) {
      return String(roomKeywords[0]);
    }
    return pickRandomKeyword();
  }

  function getLiveCommentTargetRoom() {
    var botConfig = config.task.liveCommentBotConfig || {};
    return botConfig.targetRoom || {};
  }

  function shouldEnterTargetLiveRoom() {
    var targetRoom = getLiveCommentTargetRoom();
    return targetRoom.enabled === true && !!(
      targetRoom.anchorName ||
      (targetRoom.titleKeywords && targetRoom.titleKeywords.length) ||
      (targetRoom.roomKeywords && targetRoom.roomKeywords.length)
    );
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
      counters.lastSearchKeyword = liveKeyword;
      context.targetLiveRoomEntry = {
        enteredAt: Date.now(),
        keyword: liveKeyword,
        anchorName: targetRoom.anchorName || "",
        titleKeywords: targetRoom.titleKeywords || [],
        roomKeywords: targetRoom.roomKeywords || []
      };
      logger.info("live comment: entered target live room from search", {
        reason: reason || "",
        keyword: liveKeyword,
        anchorName: targetRoom.anchorName || ""
      });
      controlLoop.reportRuntimeLog("INFO", "live comment: entered target live room from search", {
        phase: "live_comment_target_search",
        reason: reason || "",
        keyword: liveKeyword,
        anchorName: targetRoom.anchorName || ""
      });
      return true;
    }
    logger.warn("live comment: target live room search failed", {
      reason: reason || "",
      keyword: liveKeyword,
      anchorName: targetRoom.anchorName || ""
    });
    controlLoop.reportRuntimeLog("WARN", "live comment: target live room search failed", {
      phase: "live_comment_target_search",
      reason: reason || "",
      keyword: liveKeyword,
      anchorName: targetRoom.anchorName || ""
    });
    return false;
  }

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

  function enterFlow() {
    var flowStartedAt = Date.now();
    floatyControl.update({ lastMessage: "打开抖音" });
    logger.info("启动流程：打开抖音", { elapsedMs: Date.now() - flowStartedAt });
    if (!douyin.openApp()) {
      throw new Error("无法打开抖音");
    }
    if (shouldAbortFlow()) {
      return false;
    }
    logger.info("启动流程：抖音已打开", { elapsedMs: Date.now() - flowStartedAt });

    if (isLiveCommentPriorityRequested()) {
      logger.info("live comment control requested: force target room search flow");
      if (tryEnterTargetLiveRoomFromSearch(config.task.liveCommentDirectTest === true ? "direct_test" : "control_start")) {
        return true;
      }
      return false;
    }

    if (config.task.liveCommentDirectTest === true) {
      if (tryEnterTargetLiveRoomFromSearch("direct_test")) {
        return true;
      }
    }

    if (config.task.liveCommentDirectTest === true) {
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

  function runOneTask() {
    resetRunCounters();
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
      status: "running"
    });
    runBackground("脚本启动任务心跳上报", function () {
      heartbeatService.reportImmediateHeartbeat("", "running", "启动任务");
    });
    controlLoop.refreshRuntimeConfig();
    if (config.task.liveCommentDirectTest === true) {
      floatyControl.update({
        liveCommentControlStatus: "running",
        liveCommentExecutionEnabled: true
      });
    }
    var liveCommentPriority = !!context.liveCommentPriorityRequested ||
      floatyControl.state.liveCommentControlStatus === "running";
    var mustVerifyTargetLiveRoom = (liveCommentPriority || config.task.liveCommentDirectTest === true) &&
      shouldEnterTargetLiveRoom();
    var alreadyInLiveRoom = false;
    try {
      alreadyInLiveRoom = !mustVerifyTargetLiveRoom &&
        config.task.liveCommentDirectTest === true &&
        douyin.isForeground && douyin.isForeground() &&
        douyin.isLiveRoomVisible && douyin.isLiveRoomVisible();
    } catch (error) {
      alreadyInLiveRoom = false;
    }
    if (!alreadyInLiveRoom && !enterFlow()) {
      logger.warn("启动流程被停止请求打断", {
        stopRequested: floatyControl.state.stopRequested,
        exitRequested: floatyControl.state.exitRequested
      });
      finishTask();
      return;
    }

    if (config.schedule.enabled) {
      var todayVideoMinutes = randomMinutes(config.schedule.videoMinutesMin, config.schedule.videoMinutesMax);
      var todayLiveMinutes = randomMinutes(config.schedule.liveMinutesMin, config.schedule.liveMinutesMax);
      counters.plannedVideoMinutes = liveCommentPriority ? 0 : (counters.plannedVideoMinutes || todayVideoMinutes);
      counters.plannedLiveMinutes = counters.plannedLiveMinutes || todayLiveMinutes;
      counters.videoElapsedMinutes = counters.videoElapsedMinutes || 0;
      counters.videoRemainingMinutes = Math.max(0, counters.plannedVideoMinutes - counters.videoElapsedMinutes);
      counters.liveElapsedMinutes = counters.liveElapsedMinutes || 0;
      counters.liveRemainingMinutes = Math.max(0, counters.plannedLiveMinutes - counters.liveElapsedMinutes);
      if (liveCommentPriority) {
        counters.videoRemainingMinutes = 0;
        counters.liveRemainingMinutes = Math.max(1, counters.liveRemainingMinutes || counters.plannedLiveMinutes || todayLiveMinutes);
        logger.info("live comment control requested, prioritize live phase", {
          liveMinutes: counters.liveRemainingMinutes
        });
        controlLoop.reportRuntimeLog("INFO", "live comment control requested, prioritize live phase", {
          liveMinutes: counters.liveRemainingMinutes
        });
      }
      logger.info("今日随机采集时长", {
        videoMinutes: counters.plannedVideoMinutes,
        liveMinutes: counters.plannedLiveMinutes
      });
      if (counters.videoRemainingMinutes > 0) {
        phaseRunner.runPhase("video", counters.videoRemainingMinutes);
      } else {
        logger.info("今日视频阶段已完成，跳过视频阶段", {
          plannedVideoMinutes: counters.plannedVideoMinutes,
          videoElapsedMinutes: counters.videoElapsedMinutes
        });
      }
      if (counters.lastStopReason === "phase_expired_while_paused") {
        logger.warn("旧视频阶段已过期，丢弃旧任务并重新开始一轮任务", {
          lastStopReason: counters.lastStopReason
        });
        floatyControl.update({
          running: true,
          paused: false,
          stopRequested: false,
          lastMessage: "旧任务已过期，重新开始"
        });
        return;
      }
      logger.info("视频阶段结束，判断是否进入直播阶段", {
        stopRequested: floatyControl.state.stopRequested,
        exitRequested: floatyControl.state.exitRequested,
        lastStopReason: counters.lastStopReason,
        plannedLiveMinutes: counters.plannedLiveMinutes
      });
      if (!floatyControl.state.stopRequested && !floatyControl.state.exitRequested) {
        if (counters.liveRemainingMinutes > 0) {
          phaseRunner.runPhase("live", counters.liveRemainingMinutes);
        } else {
          logger.info("今日直播阶段已完成，跳过直播阶段", {
            plannedLiveMinutes: counters.plannedLiveMinutes,
            liveElapsedMinutes: counters.liveElapsedMinutes
          });
        }
        if (counters.lastStopReason === "phase_expired_while_paused") {
          logger.warn("旧直播阶段已过期，丢弃旧任务并重新开始一轮任务", {
            lastStopReason: counters.lastStopReason
          });
          floatyControl.update({
            running: true,
            paused: false,
            stopRequested: false,
            lastMessage: "旧任务已过期，重新开始"
          });
          return;
        }
      } else {
        logger.warn("直播阶段跳过", {
          stopRequested: floatyControl.state.stopRequested,
          exitRequested: floatyControl.state.exitRequested,
          lastStopReason: counters.lastStopReason
        });
        controlLoop.reportRuntimeLog("WARN", "直播阶段跳过", {
          stopRequested: floatyControl.state.stopRequested,
          exitRequested: floatyControl.state.exitRequested,
          lastStopReason: counters.lastStopReason
        });
      }
    } else {
      phaseRunner.runPhase("video", 24 * 60);
    }

    finishTask();
  }

  function finishTask() {
    counters.currentPhase = "";
    counters.phaseStartedAt = "";
    counters.phaseEndedAt = "";
    floatyControl.update({
      running: false,
      paused: true,
      stopRequested: !!floatyControl.state.exitRequested,
      manualOverride: true,
      lastManualAction: "task_finished",
      lastMessage: "任务结束，待命中"
    });
    logger.info("农业视频手机采集脚本结束", counters);
    controlLoop.reportRuntimeLog("INFO", "农业视频手机采集脚本结束", counters);
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
          controlLoop.pollControlCommandsAsync(false);
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
