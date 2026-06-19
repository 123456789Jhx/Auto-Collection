function createControlLoop(context) {
  var config = context.config;
  var logger = context.logger;
  var uploader = context.uploader;
  var floatyControl = context.floatyControl;
  var counters = context.counters;
  var commandControl = context.commandControl;
  var heartbeatService = context.heartbeatService;
  var backendSync = context.backendSync || {
    lastAt: 0,
    running: false,
    failureCount: 0,
    lastFailureLogAt: 0,
    ready: false
  };
  context.backendSync = backendSync;

  function reportRuntimeLog(level, message, logContext) {
    uploader.uploadRuntimeLog(level, message, logContext || {});
  }

  function isStateCommand(commandType) {
    return commandType === "START" || commandType === "RESUME" || commandType === "PAUSE" || commandType === "STOP";
  }

  function compactControlCommands(commands) {
    var latestStateIndex = -1;
    for (var i = 0; i < commands.length; i++) {
      if (isStateCommand(commands[i].commandType)) {
        latestStateIndex = i;
      }
    }
    if (latestStateIndex < 0) {
      return commands;
    }

    var compacted = [];
    for (var j = 0; j < commands.length; j++) {
      var command = commands[j];
      if (isStateCommand(command.commandType) && j !== latestStateIndex) {
        logger.warn("忽略已被更新指令覆盖的后台控制指令", {
          commandId: command.id,
          commandType: command.commandType,
          latestCommandId: commands[latestStateIndex].id,
          latestCommandType: commands[latestStateIndex].commandType
        });
        uploader.ackCommand(command.id, "IGNORED", {
          applied: false,
          commandType: command.commandType,
          reason: "superseded_by_newer_state_command",
          latestCommandId: commands[latestStateIndex].id,
          latestCommandType: commands[latestStateIndex].commandType
        });
        continue;
      }
      compacted.push(command);
    }
    return compacted;
  }

  function pollControlCommands(force) {
    if (!config.upload.controlEnabled) {
      return;
    }
    var intervalMs = (config.upload.commandPollIntervalSeconds || 30) * 1000;
    var now = Date.now();
    if (!force && now - commandControl.lastPollAt < intervalMs) {
      return;
    }
    commandControl.lastPollAt = now;

    var commands = compactControlCommands(uploader.pollCommands(config.device.deviceId));
    if (commands.length > 0 || force) {
      logger.info("后台控制指令轮询结果", {
        force: force,
        commandCount: commands.length,
        paused: floatyControl.state.paused,
        stopRequested: floatyControl.state.stopRequested
      });
      reportRuntimeLog("INFO", "后台控制指令轮询结果", {
        force: force,
        commandCount: commands.length,
        paused: floatyControl.state.paused,
        stopRequested: floatyControl.state.stopRequested
      });
    }
    for (var i = 0; i < commands.length; i++) {
      handleControlCommand(commands[i]);
    }
  }

  function pollControlCommandsAsync(force) {
    if (!config.upload.controlEnabled) {
      return;
    }
    if (commandControl.polling) {
      return;
    }

    try {
      if (typeof threads === "undefined" || !threads.start) {
        logger.warn("后台控制指令异步轮询跳过，当前环境不支持后台线程");
        return;
      }

      commandControl.polling = true;
      threads.start(function () {
        try {
          pollControlCommands(force);
        } catch (error) {
          logger.warn("后台控制指令异步轮询失败", { message: String(error) });
        } finally {
          commandControl.polling = false;
        }
      });
    } catch (error2) {
      commandControl.polling = false;
      logger.warn("后台控制指令异步轮询线程启动失败", { message: String(error2) });
    }
  }

  function nextBackendSyncDelayMs() {
    if (backendSync.failureCount <= 3) {
      return Number(config.upload.startupRetryFastMs || 10 * 1000);
    }
    if (backendSync.failureCount <= 10) {
      return Number(config.upload.startupRetryMediumMs || 30 * 1000);
    }
    return Number(config.upload.startupRetrySlowMs || 60 * 1000);
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

  function syncBackendOnce(reason) {
    if (!config.upload.enabled) {
      return { success: false, message: "upload disabled" };
    }

    var tokenResult = uploader.registerDeviceToken();
    var configResult = refreshRuntimeConfig();
    if (tokenResult && tokenResult.success && configResult && configResult.applied) {
      backendSync.failureCount = 0;
      backendSync.ready = true;
      logger.info("backend sync ready", {
        reason: reason,
        autoStart: !!config.schedule.autoStart,
        running: !!floatyControl.state.running,
        paused: !!floatyControl.state.paused,
        manualOverride: !!floatyControl.state.manualOverride,
        lastManualAction: floatyControl.state.lastManualAction || ""
      });
      if (
        config.schedule.autoStart &&
        !floatyControl.state.manualOverride &&
        !floatyControl.state.running &&
        !floatyControl.state.paused &&
        !floatyControl.state.stopRequested &&
        !floatyControl.state.exitRequested
      ) {
        floatyControl.update({
          running: true,
          paused: false,
          stopRequested: false,
          lastMessage: "后台连接恢复，自动执行任务"
        });
      }
      uploader.retryCached();
      var status = currentAgentStatus();
      heartbeatService.reportAgentHeartbeat(
        status,
        status === "running" ? "后台连接已恢复" : (status === "paused" ? "保持暂停" : "未执行任务"),
        true
      );
      return { success: true, applied: true, message: "backend synced" };
    }

    backendSync.failureCount += 1;
    backendSync.ready = false;
    var now = Date.now();
    var logIntervalMs = Number(config.upload.failureLogIntervalMs || 5 * 60 * 1000);
    if (backendSync.failureCount === 1 || backendSync.failureCount % 10 === 0 || now - backendSync.lastFailureLogAt >= logIntervalMs) {
      backendSync.lastFailureLogAt = now;
      logger.warn("backend sync not ready", {
        reason: reason,
        failureCount: backendSync.failureCount,
        tokenSuccess: !!(tokenResult && tokenResult.success),
        configApplied: !!(configResult && configResult.applied),
        nextRetrySeconds: Math.round(nextBackendSyncDelayMs() / 1000)
      });
    }
    return { success: false, applied: false, message: "backend not ready" };
  }

  function syncBackendAsync(force, reason) {
    var now = Date.now();
    var delayMs = backendSync.ready ? Number(config.upload.backendReadySyncIntervalMs || 5 * 60 * 1000) : nextBackendSyncDelayMs();
    if (!force && now - backendSync.lastAt < delayMs) {
      return;
    }
    if (backendSync.running) {
      return;
    }

    backendSync.lastAt = now;
    try {
      if (typeof threads === "undefined" || !threads.start) {
        syncBackendOnce(reason || "sync");
        return;
      }
      backendSync.running = true;
      threads.start(function () {
        try {
          syncBackendOnce(reason || "sync");
        } catch (error) {
          backendSync.failureCount += 1;
          backendSync.ready = false;
          logger.warn("backend sync failed", { reason: reason || "sync", message: String(error) });
        } finally {
          backendSync.running = false;
        }
      });
    } catch (error2) {
      backendSync.running = false;
      backendSync.failureCount += 1;
      backendSync.ready = false;
      logger.warn("backend sync thread failed", { reason: reason || "sync", message: String(error2) });
    }
  }

  function handleControlCommand(command) {
    var commandType = command.commandType;
    var payload = command.payload || command.payloadJson || {};
    logger.info("收到后台控制指令", {
      commandId: command.id,
      commandType: commandType,
      payload: payload
    });
    reportRuntimeLog("INFO", "收到后台控制指令", {
      commandId: command.id,
      commandType: commandType,
      payload: payload
    });

    try {
      if (payload.taskType === "live_comment_control") {
        handleLiveCommentControlCommand(command, payload);
        return;
      }
      if (commandType === "START" || commandType === "RESUME") {
        floatyControl.update({
          running: true,
          paused: false,
          stopRequested: false,
          manualOverride: false,
          lastManualAction: "backend_" + commandType,
          lastMessage: "后台指令恢复运行"
        });
        logCommandApplied(command, "INFO", {
          running: true,
          paused: false,
          stopRequested: false
        });
        heartbeatService.reportImmediateHeartbeat(counters.currentPhase, "running", "后台指令恢复运行");
        uploader.ackCommand(command.id, "DONE", { applied: true, commandType: commandType });
        return;
      }
      if (commandType === "PAUSE") {
        floatyControl.update({
          running: true,
          paused: true,
          manualOverride: true,
          lastManualAction: "backend_pause",
          lastMessage: "后台指令暂停"
        });
        logCommandApplied(command, "INFO", {
          running: floatyControl.state.running,
          paused: true,
          stopRequested: false
        });
        heartbeatService.reportImmediateHeartbeat(counters.currentPhase, "paused", "后台指令暂停");
        uploader.ackCommand(command.id, "DONE", { applied: true, commandType: commandType });
        return;
      }
      if (commandType === "STOP") {
        counters.lastStopReason = "backend_close";
        floatyControl.update({
          running: false,
          stopRequested: true,
          exitRequested: true,
          paused: false,
          manualOverride: true,
          lastManualAction: "backend_close",
          lastMessage: "后台指令关闭脚本"
        });
        logCommandApplied(command, "WARN", {
          running: floatyControl.state.running,
          paused: false,
          stopRequested: true,
          exitRequested: true,
          stopReason: counters.lastStopReason
        });
        heartbeatService.reportImmediateHeartbeat(counters.currentPhase, "stopped", "后台指令关闭脚本");
        uploader.ackCommand(command.id, "DONE", { applied: true, commandType: commandType });
        return;
      }
      if (commandType === "STATUS") {
        uploader.ackCommand(command.id, "DONE", {
          applied: true,
          commandType: commandType,
          counters: counters,
          paused: floatyControl.state.paused,
          stopRequested: floatyControl.state.stopRequested
        });
        return;
      }
      if (commandType === "REFRESH_CONFIG") {
        var configResult = refreshRuntimeConfig();
        uploader.ackCommand(command.id, "DONE", {
          applied: !!configResult.applied,
          commandType: commandType,
          message: configResult.message,
          config: configResult.config || null
        });
        return;
      }
      if (commandType === "RESTART_APP") {
        floatyControl.update({ lastMessage: "后台指令重启抖音" });
        context.douyin.restartToFeed();
        uploader.ackCommand(command.id, "DONE", { applied: true, commandType: commandType });
        return;
      }
      if (commandType === "UPLOAD_LOG") {
        var uploadPayload = command.payload || command.payloadJson || {};
        var uploadResult = uploader.uploadLogFilesByOptions
          ? uploader.uploadLogFilesByOptions(uploadPayload)
          : (uploader.uploadRecentLogFiles ? uploader.uploadRecentLogFiles(uploadPayload.days || 7) : uploader.uploadLogFile(logger.getLogFile ? logger.getLogFile() : ""));
        uploader.ackCommand(command.id, uploadResult.success ? "DONE" : "FAILED", {
          applied: !!uploadResult.success,
          commandType: commandType,
          message: uploadResult.message,
          statusCode: uploadResult.statusCode,
          uploadedCount: uploadResult.uploadedCount || 0,
          failedCount: uploadResult.failedCount || 0,
          payload: uploadPayload
        });
        return;
      }
      if (commandType === "CHECK_UPDATE" || commandType === "UPDATE_AGENT") {
        var result = uploader.checkAgentVersion();
        var updateAvailable = !!(result && result.updateAvailable);
        uploader.uploadAgentUpdateEvent({
          eventType: "CHECKED",
          fromVersion: config.app.version,
          toVersion: result && result.latestVersion ? result.latestVersion.version : config.app.version,
          message: updateAvailable ? "后台指令触发版本检查，发现新版本" : "后台指令触发版本检查，当前已是最新版本",
          payload: result || {}
        });
        uploader.ackCommand(command.id, "DONE", {
          applied: commandType === "CHECK_UPDATE",
          commandType: commandType,
          updateAvailable: updateAvailable,
          message: commandType === "UPDATE_AGENT" ? "远程替换脚本待接入，当前仅完成版本检查和事件上报" : "版本检查完成"
        });
        return;
      }
      if (commandType === "RESTART_AGENT") {
        uploader.ackCommand(command.id, "IGNORED", {
          applied: false,
          commandType: commandType,
          message: "AutoX.js 脚本自重启待接入，当前保持 Agent 常驻运行"
        });
        return;
      }
      uploader.ackCommand(command.id, "IGNORED", { applied: false, commandType: commandType });
    } catch (error) {
      uploader.ackCommand(command.id, "FAILED", { message: String(error), commandType: commandType });
    }
  }

  function handleLiveCommentControlCommand(command, payload) {
    var commandType = command.commandType;
    if (commandType === "REFRESH_CONFIG") {
      var configResult = refreshRuntimeConfig();
      uploader.ackCommand(command.id, "DONE", {
        applied: !!configResult.applied,
        commandType: commandType,
        taskType: payload.taskType,
        message: configResult.message,
        config: configResult.config || null
      });
      return;
    }
    if (commandType === "START" || commandType === "RESUME") {
      context.liveCommentPriorityRequested = true;
      floatyControl.update({
        running: true,
        paused: false,
        stopRequested: false,
        manualOverride: false,
        liveCommentControlStatus: "running",
        liveCommentExecutionEnabled: true,
        lastManualAction: "backend_live_comment_" + commandType,
        lastMessage: "直播评论已启动"
      });
      logCommandApplied(command, "INFO", {
        taskType: payload.taskType,
        running: true,
        paused: false,
        liveCommentControlStatus: "running",
        liveCommentExecutionEnabled: true
      });
      heartbeatService.reportImmediateHeartbeat(counters.currentPhase, currentAgentStatus(), "直播评论已启动");
      uploader.ackCommand(command.id, "DONE", { applied: true, commandType: commandType, taskType: payload.taskType });
      return;
    }
    if (commandType === "PAUSE") {
      floatyControl.update({
        liveCommentControlStatus: "paused",
        liveCommentExecutionEnabled: false,
        lastManualAction: "backend_live_comment_pause",
        lastMessage: "直播评论已暂停"
      });
      logCommandApplied(command, "INFO", {
        taskType: payload.taskType,
        liveCommentControlStatus: "paused",
        liveCommentExecutionEnabled: false
      });
      heartbeatService.reportImmediateHeartbeat(counters.currentPhase, currentAgentStatus(), "直播评论已暂停");
      uploader.ackCommand(command.id, "DONE", { applied: true, commandType: commandType, taskType: payload.taskType });
      return;
    }
    if (commandType === "STOP") {
      floatyControl.update({
        liveCommentControlStatus: "stopped",
        liveCommentExecutionEnabled: false,
        lastManualAction: "backend_live_comment_stop",
        lastMessage: "直播评论已停止"
      });
      logCommandApplied(command, "INFO", {
        taskType: payload.taskType,
        liveCommentControlStatus: "stopped",
        liveCommentExecutionEnabled: false
      });
      heartbeatService.reportImmediateHeartbeat(counters.currentPhase, currentAgentStatus(), "直播评论已停止");
      uploader.ackCommand(command.id, "DONE", { applied: true, commandType: commandType, taskType: payload.taskType });
      return;
    }
    uploader.ackCommand(command.id, "IGNORED", {
      applied: false,
      commandType: commandType,
      taskType: payload.taskType,
      reason: "unsupported_live_comment_command"
    });
  }

  function logCommandApplied(command, level, state) {
    var payload = {
      commandId: command.id,
      commandType: command.commandType
    };
    Object.keys(state).forEach(function (key) {
      payload[key] = state[key];
    });
    logger.info("后台控制指令已执行", payload);
    reportRuntimeLog(level, "后台控制指令已执行", payload);
  }

  function refreshRuntimeConfig() {
    var remoteConfig = uploader.fetchCurrentTask();
    if (!remoteConfig) {
      return {
        applied: false,
        message: "配置拉取失败，当前脚本继续使用本地配置"
      };
    }

    var videoMinutesMin = Math.max(120, Number(remoteConfig.videoMinutesMin || config.schedule.videoMinutesMin || 120));
    var videoMinutesMax = Math.max(videoMinutesMin, Number(remoteConfig.videoMinutesMax || config.schedule.videoMinutesMax || 180));
    var liveMinutesMin = Math.max(60, Number(remoteConfig.liveMinutesMin || config.schedule.liveMinutesMin || 60));
    var liveMinutesMax = Math.max(liveMinutesMin, Number(remoteConfig.liveMinutesMax || config.schedule.liveMinutesMax || 120));
    var heartbeatMinutes = Math.max(1, Number(remoteConfig.heartbeatMinutes || config.runtime.heartbeatMinutes || 1));

    config.task.taskId = remoteConfig.taskId || config.task.taskId;
    config.task.platform = remoteConfig.platform || config.task.platform;
    config.task.mode = remoteConfig.mode || config.task.mode;
    if (remoteConfig.searchKeywords && remoteConfig.searchKeywords.length) {
      config.task.keywords = remoteConfig.searchKeywords;
    }
    if (remoteConfig.matchKeywords && remoteConfig.matchKeywords.length) {
      config.match.agricultureKeywords = remoteConfig.matchKeywords;
    }
    config.schedule.videoMinutesMin = videoMinutesMin;
    config.schedule.videoMinutesMax = videoMinutesMax;
    config.schedule.liveMinutesMin = liveMinutesMin;
    config.schedule.liveMinutesMax = liveMinutesMax;
    config.schedule.autoStart = remoteConfig.autoStart === true;
    config.task.collectComments = remoteConfig.collectComments !== false;
    config.task.commentLimit = Math.max(0, Number(remoteConfig.commentLimit || config.task.commentLimit || 10));
    if (!config.task.liveComment) {
      config.task.liveComment = {};
    }
    var liveCommentRole = remoteConfig.liveCommentRole === "followed" || remoteConfig.liveCommentRole === "follower" ? remoteConfig.liveCommentRole : "none";
    var liveCommentGroup = remoteConfig.liveCommentGroup === "A" || remoteConfig.liveCommentGroup === "B" || remoteConfig.liveCommentGroup === "C" ? remoteConfig.liveCommentGroup : "";
    var liveCommentMode = remoteConfig.liveCommentMode === "off" || remoteConfig.liveCommentMode === "target_follow" || remoteConfig.liveCommentMode === "agri_chatbot" ? remoteConfig.liveCommentMode : "agri_chatbot";
    config.task.liveCommentRole = liveCommentRole;
    config.task.liveCommentGroup = liveCommentGroup;
    config.task.liveCommentMode = liveCommentMode;
    config.task.accountProfile = sanitizeObjectConfig(remoteConfig.accountProfile, config.task.accountProfile || {});
    config.task.liveCommentBotConfig = sanitizeObjectConfig(remoteConfig.liveCommentBotConfig, config.task.liveCommentBotConfig || {});
    config.task.followedAccounts = sanitizeFollowedAccounts(remoteConfig.followedAccounts || []);
    if (remoteConfig.liveCommentConfig && typeof remoteConfig.liveCommentConfig === "object") {
      var liveCommentConfig = sanitizeLiveCommentConfig(remoteConfig.liveCommentConfig);
      var accountTargets = buildFollowedAccountTargets(config.task.followedAccounts);
      if (accountTargets.names.length > 0 || accountTargets.ids.length > 0) {
        liveCommentConfig.leaderAccountNames = accountTargets.names;
        liveCommentConfig.leaderAccountIds = accountTargets.ids;
      }
      if (liveCommentGroup) {
        liveCommentConfig.groupName = liveCommentGroup;
      }
      Object.keys(liveCommentConfig).forEach(function (key) {
        config.task.liveComment[key] = liveCommentConfig[key];
      });
      if (context.liveTriggerDetector && context.liveTriggerDetector.updateOptions) {
        context.liveTriggerDetector.updateOptions({
          leaderAccountNames: config.task.liveComment.leaderAccountNames,
          leaderAccountIds: config.task.liveComment.leaderAccountIds,
          triggerKeywords: config.task.liveComment.triggerKeywords
        });
      }
      if (context.liveCommentActionPlanner && context.liveCommentActionPlanner.updateOptions) {
        context.liveCommentActionPlanner.updateOptions(config.task.liveComment);
      }
      if (context.liveCommentCache && context.liveCommentCache.updateOptions) {
        context.liveCommentCache.updateOptions({
          maxSize: config.task.liveComment.localCommentCacheSize
        });
      }
    }
    if (remoteConfig.p3ExtensionsConfig && typeof remoteConfig.p3ExtensionsConfig === "object") {
      config.p3Extensions = sanitizeP3ExtensionsConfig(remoteConfig.p3ExtensionsConfig);
    }
    config.runtime.heartbeatMinutes = heartbeatMinutes;
    config.runtime.idleHeartbeatSeconds = Math.max(30, Number(config.runtime.idleHeartbeatSeconds || 60));

    var appliedConfig = {
      taskId: config.task.taskId,
      configSource: remoteConfig.configSource || "task",
      videoMinutesMin: videoMinutesMin,
      videoMinutesMax: videoMinutesMax,
      liveMinutesMin: liveMinutesMin,
      liveMinutesMax: liveMinutesMax,
      autoStart: config.schedule.autoStart,
      heartbeatMinutes: heartbeatMinutes,
      commentLimit: config.task.commentLimit,
      liveCommentRole: config.task.liveCommentRole,
      liveCommentGroup: config.task.liveCommentGroup,
      liveCommentMode: config.task.liveCommentMode,
      accountProfileName: config.task.accountProfile && config.task.accountProfile.profileName || "",
      botName: config.task.liveCommentBotConfig && config.task.liveCommentBotConfig.botName || "",
      followedAccountCount: config.task.followedAccounts.length,
      liveCommentConfigApplied: !!remoteConfig.liveCommentConfig,
      p3ExtensionsConfigApplied: !!remoteConfig.p3ExtensionsConfig
    };

    logger.info("后台配置已应用到当前脚本", appliedConfig);
    reportRuntimeLog("INFO", "后台配置已应用到当前脚本", appliedConfig);
    heartbeatService.reportImmediateHeartbeat(counters.currentPhase, currentAgentStatus(), "后台配置已刷新");
    return {
      applied: true,
      message: "配置已刷新，下一阶段按新随机区间执行",
      config: appliedConfig
    };
  }

  function waitWhilePaused() {
    while (floatyControl.state.paused && !floatyControl.state.stopRequested && !floatyControl.state.exitRequested) {
      floatyControl.update({ lastMessage: "已暂停" });
      pollControlCommandsAsync(false);
      sleep(300);
    }
  }

  return {
    pollControlCommands: pollControlCommands,
    pollControlCommandsAsync: pollControlCommandsAsync,
    refreshRuntimeConfig: refreshRuntimeConfig,
    waitWhilePaused: waitWhilePaused,
    reportRuntimeLog: reportRuntimeLog,
    syncBackendOnce: syncBackendOnce,
    syncBackendAsync: syncBackendAsync
  };

  function normalizeStringList(value, maxItems, maxLength) {
    if (!value || !value.length) {
      return [];
    }
    var result = [];
    for (var i = 0; i < value.length && result.length < maxItems; i++) {
      var item = String(value[i] || "").replace(/\s+/g, " ").trim();
      if (item && item.length <= maxLength) {
        result.push(item);
      }
    }
    return result;
  }

  function sanitizeFollowedAccounts(value) {
    if (!value || !value.length) {
      return [];
    }
    var result = [];
    for (var i = 0; i < value.length && result.length < 20; i++) {
      var item = value[i] || {};
      var accountName = normalizeStringList([item.accountName || ""], 1, 100)[0] || "";
      var accountId = normalizeStringList([item.accountId || ""], 1, 100)[0] || "";
      var aliasNames = normalizeStringList(item.aliasNames || [], 20, 100);
      if (accountName || accountId || aliasNames.length > 0) {
        result.push({
          accountName: accountName,
          accountId: accountId,
          aliasNames: aliasNames
        });
      }
    }
    return result;
  }

  function sanitizeObjectConfig(value, fallback) {
    if (!value || typeof value !== "object" || value.length) {
      return fallback || {};
    }
    return value;
  }

  function buildFollowedAccountTargets(accounts) {
    var names = [];
    var ids = [];
    for (var i = 0; i < accounts.length; i++) {
      var account = accounts[i] || {};
      if (account.accountName) {
        names.push(account.accountName);
      }
      var aliasNames = account.aliasNames || [];
      for (var j = 0; j < aliasNames.length; j++) {
        names.push(aliasNames[j]);
      }
      if (account.accountId) {
        ids.push(account.accountId);
      }
    }
    return {
      names: normalizeStringList(names, 40, 100),
      ids: normalizeStringList(ids, 40, 100)
    };
  }

  function clampNumber(value, fallback, minValue, maxValue) {
    var number = Number(value);
    if (!isFinite(number)) {
      number = fallback;
    }
    number = Math.max(minValue, Math.min(maxValue, number));
    return Math.floor(number);
  }

  function sanitizeReplyPools(value) {
    var source = value || {};
    return {
      A: normalizeStringList(source.A || [], 30, 80),
      B: normalizeStringList(source.B || [], 30, 80),
      C: normalizeStringList(source.C || [], 30, 80)
    };
  }

  function sanitizeLiveCommentConfig(value) {
    value = value || {};
    var result = {};
    if (typeof value.enabled === "boolean") {
      result.enabled = value.enabled;
    }
    result.executeEnabled = value.executeEnabled === true;
    result.manualExecutionApproved = value.manualExecutionApproved === true;
    if (value.groupName === "A" || value.groupName === "B" || value.groupName === "C") {
      result.groupName = value.groupName;
    }
    if (value.leaderAccountNames) {
      result.leaderAccountNames = normalizeStringList(value.leaderAccountNames, 20, 100);
    }
    if (value.leaderAccountIds) {
      result.leaderAccountIds = normalizeStringList(value.leaderAccountIds, 20, 100);
    }
    if (value.triggerKeywords) {
      result.triggerKeywords = normalizeStringList(value.triggerKeywords, 50, 30);
    }
    if (value.replyPools) {
      result.replyPools = sanitizeReplyPools(value.replyPools);
    }
    result.sendDelayMinMs = clampNumber(value.sendDelayMinMs, config.task.liveComment.sendDelayMinMs || 500, 500, 60000);
    result.sendDelayMaxMs = clampNumber(value.sendDelayMaxMs, config.task.liveComment.sendDelayMaxMs || 3000, result.sendDelayMinMs, 120000);
    result.perDeviceCooldownSeconds = clampNumber(value.perDeviceCooldownSeconds, config.task.liveComment.perDeviceCooldownSeconds || 10, 10, 3600);
    result.localCommentCacheSize = clampNumber(value.localCommentCacheSize, config.task.liveComment.localCommentCacheSize || 200, 20, 2000);
    result.maxConsecutiveSendFailures = clampNumber(value.maxConsecutiveSendFailures, config.task.liveComment.maxConsecutiveSendFailures || 3, 1, 10);
    result.perTaskMaxComments = clampNumber(value.perTaskMaxComments, config.task.liveComment.perTaskMaxComments || 60, 1, 500);
    if (value.lowConfidenceAction === "skip" || value.lowConfidenceAction === "log_only") {
      result.lowConfidenceAction = value.lowConfidenceAction;
    }
    return result;
  }

  function sanitizeP3ExtensionsConfig(value) {
    value = value || {};
    var current = config.p3Extensions || {};
    var result = {
      liveLike: {
        enabled: false,
        manualExecutionApproved: false,
        maxLikesPerLiveRoom: clampNumber(value.liveLike && value.liveLike.maxLikesPerLiveRoom, current.liveLike && current.liveLike.maxLikesPerLiveRoom || 0, 0, 3),
        minIntervalSeconds: clampNumber(value.liveLike && value.liveLike.minIntervalSeconds, current.liveLike && current.liveLike.minIntervalSeconds || 60, 30, 3600),
        requireManualApproval: true
      },
      authorizedFollow: {
        enabled: false,
        manualExecutionApproved: false,
        requireEmployeeAuthorization: true,
        targetAccountId: value.authorizedFollow && value.authorizedFollow.targetAccountId ? normalizeStringList([value.authorizedFollow.targetAccountId], 1, 100)[0] || "" : "",
        targetAccountName: value.authorizedFollow && value.authorizedFollow.targetAccountName ? normalizeStringList([value.authorizedFollow.targetAccountName], 1, 100)[0] || "" : "",
        independentTaskOnly: true
      },
      linkage: {
        allowM1Input: false,
        allowM2Input: false,
        allowM3OutputToMaterialPool: false
      }
    };
    return result;
  }
}

module.exports = {
  createControlLoop: createControlLoop
};
