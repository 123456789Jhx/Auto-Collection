function createControlLoop(context) {
  var config = context.config;
  var logger = context.logger;
  var uploader = context.uploader;
  var floatyControl = context.floatyControl;
  var counters = context.counters;
  var commandControl = context.commandControl;
  var heartbeatService = context.heartbeatService;
  var taskScheduler = context.taskScheduler;
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

  function commandTaskKey(command) {
    var payload = command && (command.payload || command.payloadJson || {}) || {};
    return normalizeCommandTaskType(payload.taskType, "video");
  }

  function hasExplicitTaskType(command) {
    var payload = command && (command.payload || command.payloadJson || {}) || {};
    return !!(payload && payload.taskType);
  }

  function isGlobalStopCommand(command) {
    return command && command.commandType === "STOP" && !hasExplicitTaskType(command);
  }

  function ackSupersededCommand(command, reason, latestCommand) {
    var taskKey = commandTaskKey(command);
    logger.warn(reason === "superseded_by_stop_command" ? "忽略已被停止指令覆盖的后台控制指令" : "忽略已被更新指令覆盖的后台控制指令", {
      commandId: command.id,
      commandType: command.commandType,
      taskType: taskKey,
      latestCommandId: latestCommand && latestCommand.id,
      latestCommandType: latestCommand && latestCommand.commandType
    });
    uploader.ackCommand(command.id, "IGNORED", {
      applied: false,
      commandType: command.commandType,
      reason: reason,
      taskType: taskKey,
      latestCommandId: latestCommand && latestCommand.id,
      latestCommandType: latestCommand && latestCommand.commandType
    });
  }

  function directNormalizeTaskType(taskType) {
    var value = String(taskType || "").trim();
    if (value === "live_comment_control" || value === "liveComment" || value === "live-comment") {
      value = "live_comment";
    }
    if (value === "commerceCardLiveComment" || value === "commerce-card-live-comment" || value === "commerce_card_live") {
      value = "commerce_card_live_comment";
    }
    if (value === "video_control" || value === "video_feed") {
      value = "video";
    }
    if (value === "live_control" || value === "live_feed") {
      value = "live";
    }
    if (value === "video" || value === "live" || value === "live_comment" || value === "commerce_card_live_comment") {
      return value;
    }
    return "";
  }

  function normalizeCommandTaskType(taskType, fallbackTaskType) {
    if (context.runRequestResolver && context.runRequestResolver.normalizeTaskType) {
      return context.runRequestResolver.normalizeTaskType(taskType, fallbackTaskType);
    }
    return directNormalizeTaskType(taskType) || directNormalizeTaskType(fallbackTaskType);
  }

  function latchRunRequest(taskType, source) {
    if (context.runRequestResolver && context.runRequestResolver.setPendingTaskType) {
      return context.runRequestResolver.setPendingTaskType(taskType, source);
    }
    return normalizeCommandTaskType(taskType);
  }

  function compactControlCommands(commands) {
    var latestGlobalStopIndex = -1;
    var latestStopIndexByTask = {};
    var latestStateIndexByTask = {};
    for (var i = 0; i < commands.length; i++) {
      if (isStateCommand(commands[i].commandType)) {
        if (commands[i].commandType === "STOP") {
          if (isGlobalStopCommand(commands[i])) {
            latestGlobalStopIndex = i;
          } else {
            latestStopIndexByTask[commandTaskKey(commands[i])] = i;
          }
        } else {
          latestStateIndexByTask[commandTaskKey(commands[i])] = i;
        }
      }
    }
    if (latestGlobalStopIndex < 0 && Object.keys(latestStopIndexByTask).length === 0 && Object.keys(latestStateIndexByTask).length === 0) {
      return commands;
    }

    var compacted = [];
    for (var j = 0; j < commands.length; j++) {
      var command = commands[j];
      if (!isStateCommand(command.commandType)) {
        compacted.push(command);
        continue;
      }

      var taskKey = commandTaskKey(command);
      if (latestGlobalStopIndex >= 0) {
        if (j !== latestGlobalStopIndex) {
          ackSupersededCommand(command, "superseded_by_stop_command", commands[latestGlobalStopIndex]);
          continue;
        }
        compacted.push(command);
        continue;
      }

      var latestStopIndex = latestStopIndexByTask[taskKey];
      if (latestStopIndex !== undefined) {
        if (j !== latestStopIndex) {
          ackSupersededCommand(command, "superseded_by_stop_command", commands[latestStopIndex]);
          continue;
        }
        compacted.push(command);
        continue;
      }

      var latestStateIndex = latestStateIndexByTask[taskKey];
      if (latestStateIndex !== undefined && j !== latestStateIndex) {
        ackSupersededCommand(command, "superseded_by_newer_state_command", commands[latestStateIndex]);
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
    var now = Date.now();
    if (!shouldPollControlCommands(force, now)) {
      return;
    }
    commandControl.lastPollAt = now;

    if (uploader.isRegistered && !uploader.isRegistered()) {
      if (force) {
        logger.warn("backend command polling skipped: device not registered", {
          deviceId: config.device.deviceId || ""
        });
      }
      return;
    }

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

  function shouldPollControlCommands(force, now) {
    if (!config.upload.controlEnabled) {
      return false;
    }
    if (force) {
      return true;
    }
    var intervalMs = (config.upload.commandPollIntervalSeconds || 30) * 1000;
    return now - commandControl.lastPollAt >= intervalMs;
  }

  function pollControlCommandsAsync(force) {
    if (!config.upload.controlEnabled) {
      return;
    }
    if (!shouldPollControlCommands(force, Date.now())) {
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

  function syncTaskSchedulerState(taskType, commandType, meta) {
    var fallbackTaskType = (commandType === "START" || commandType === "RESUME") ? "video" : "";
    var normalizedTaskType = normalizeCommandTaskType(taskType, fallbackTaskType);
    if (!normalizedTaskType && taskScheduler && taskScheduler.getActiveTaskType) {
      normalizedTaskType = normalizeCommandTaskType(taskScheduler.getActiveTaskType());
    }
    if (!normalizedTaskType) {
      return "";
    }
    if (commandType === "START" || commandType === "RESUME") {
      latchRunRequest(normalizedTaskType, meta && meta.reason ? meta.reason : "backend_" + String(commandType || "START").toLowerCase());
      if (taskScheduler) {
        taskScheduler.requestTask(normalizedTaskType, commandType, meta);
      }
      return normalizedTaskType;
    }
    if (!taskScheduler) {
      return normalizedTaskType;
    }
    if (commandType === "PAUSE") {
      taskScheduler.pauseTask(normalizedTaskType, meta);
      return normalizedTaskType;
    }
    if (commandType === "STOP") {
      taskScheduler.stopTask(normalizedTaskType, meta);
    }
    return normalizedTaskType;
  }

  function currentCheckpoint(extra) {
    var checkpoint = {
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
    };
    extra = extra || {};
    Object.keys(extra).forEach(function (key) {
      checkpoint[key] = extra[key];
    });
    return checkpoint;
  }

  function syncBackendOnce(reason) {
    if (!config.upload.enabled) {
      return { success: false, message: "upload disabled" };
    }

    var tokenResult = uploader.registerDeviceToken();
    if (!tokenResult || !tokenResult.success) {
      backendSync.failureCount += 1;
      backendSync.ready = false;
      floatyControl.update({
        lastMessage: "设备注册失败，等待重试"
      });
      var registerNow = Date.now();
      var registerLogIntervalMs = Number(config.upload.failureLogIntervalMs || 5 * 60 * 1000);
      if (backendSync.failureCount === 1 || backendSync.failureCount % 10 === 0 || registerNow - backendSync.lastFailureLogAt >= registerLogIntervalMs) {
        backendSync.lastFailureLogAt = registerNow;
        logger.warn("backend sync not ready: device registration failed", {
          reason: reason,
          failureCount: backendSync.failureCount,
          statusCode: tokenResult && tokenResult.statusCode,
          message: tokenResult && (tokenResult.message || tokenResult.body) || "",
          nextRetrySeconds: Math.round(nextBackendSyncDelayMs() / 1000)
        });
      }
      return { success: false, applied: false, message: "device registration failed" };
    }

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
    floatyControl.update({
      lastMessage: "后台未就绪，等待注册/配置同步"
    });
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
      if ((commandType === "START" || commandType === "RESUME") && hasExplicitTaskType(command) && !normalizeCommandTaskType(payload.taskType, "")) {
        logger.warn("后台指令任务类型不受当前脚本支持，已拒绝执行", {
          commandId: command.id,
          commandType: commandType,
          taskType: payload.taskType
        });
        reportRuntimeLog("ERROR", "后台指令任务类型不受当前脚本支持，已拒绝执行", {
          commandId: command.id,
          commandType: commandType,
          taskType: payload.taskType,
          reason: "unsupported_explicit_task_type"
        });
        uploader.ackCommand(command.id, "FAILED", {
          applied: false,
          commandType: commandType,
          taskType: payload.taskType,
          reason: "unsupported_explicit_task_type",
          message: "当前手机脚本不支持后台下发的任务类型"
        });
        return;
      }
      if (commandType === "START" || commandType === "RESUME") {
        var normalizedStartTaskType = syncTaskSchedulerState(payload.taskType, commandType, {
          reason: "backend_command",
          checkpoint: currentCheckpoint({ checkpointType: "backend_start" })
        });
        floatyControl.update({
          running: true,
          paused: false,
          stopRequested: false,
          manualOverride: false,
          lastManualAction: "backend_" + commandType,
          lastMessage: "后台指令恢复运行"
        });
        logCommandApplied(command, "INFO", {
          taskType: normalizedStartTaskType,
          running: true,
          paused: false,
          stopRequested: false
        });
        heartbeatService.reportImmediateHeartbeat(counters.currentPhase, "running", "后台指令恢复运行");
        uploader.ackCommand(command.id, "DONE", { applied: true, commandType: commandType, taskType: normalizedStartTaskType });
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
        syncTaskSchedulerState(payload.taskType, commandType, {
          reason: "backend_command",
          checkpoint: currentCheckpoint({ checkpointType: "backend_pause" })
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
          exitRequested: false,
          paused: true,
          manualOverride: true,
          lastManualAction: "backend_close",
          lastMessage: "后台指令停止任务"
        });
        syncTaskSchedulerState(payload.taskType, commandType, {
          reason: "backend_command",
          checkpoint: currentCheckpoint({ checkpointType: "backend_stop" })
        });
        logCommandApplied(command, "WARN", {
          running: floatyControl.state.running,
          paused: true,
          stopRequested: true,
          exitRequested: false,
          stopReason: counters.lastStopReason
        });
        heartbeatService.reportImmediateHeartbeat(counters.currentPhase, "stopped", "后台指令停止任务");
        uploader.ackCommand(command.id, "DONE", {
          applied: true,
          accepted: true,
          completed: false,
          commandType: commandType,
          message: "command accepted; task execution continues asynchronously"
        });
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
        if (payload && payload.reenterTargetRoom === true) {
          context.liveCommentPriorityRequested = true;
          context.liveCommentTargetRoomRefreshRequested = true;
          context.targetLiveRoomEntry = null;
          syncTaskSchedulerState(payload.taskType || "live_comment", "START", {
            reason: "target_room_config_saved",
            checkpoint: currentCheckpoint({ checkpointType: "target_room_refresh" })
          });
          floatyControl.update({
            running: true,
            paused: false,
            stopRequested: false,
            manualOverride: false,
            liveCommentControlStatus: "running",
            liveCommentExecutionEnabled: true,
            lastManualAction: "target_room_config_saved",
            lastMessage: "指定直播间已刷新，准备重新进入"
          });
        }
        uploader.ackCommand(command.id, "DONE", {
          applied: !!configResult.applied,
          commandType: commandType,
          taskType: payload.taskType,
          message: configResult.message,
          config: configResult.config || null,
          reenterTargetRoom: !!(payload && payload.reenterTargetRoom)
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
      if (payload && payload.reenterTargetRoom === true) {
        context.liveCommentPriorityRequested = true;
        context.liveCommentTargetRoomRefreshRequested = true;
        context.targetLiveRoomEntry = null;
        syncTaskSchedulerState(payload.taskType || "live_comment", "START", {
          reason: "target_room_config_saved",
          checkpoint: currentCheckpoint({ checkpointType: "target_room_refresh" })
        });
        floatyControl.update({
          running: true,
          paused: false,
          stopRequested: false,
          manualOverride: false,
          liveCommentControlStatus: "running",
          liveCommentExecutionEnabled: true,
          lastManualAction: "target_room_config_saved",
          lastMessage: "指定直播间已刷新，准备重新进入"
        });
      }
      uploader.ackCommand(command.id, "DONE", {
        applied: !!configResult.applied,
        commandType: commandType,
        taskType: payload.taskType,
        message: configResult.message,
        config: configResult.config || null,
        reenterTargetRoom: !!(payload && payload.reenterTargetRoom)
      });
      return;
    }
    if (commandType === "START" || commandType === "RESUME") {
      context.liveCommentPriorityRequested = true;
      var normalizedLiveCommentTaskType = syncTaskSchedulerState(payload.taskType, commandType, {
        reason: "backend_live_comment",
        checkpoint: currentCheckpoint({ checkpointType: "backend_live_comment_start" })
      });
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
        taskType: normalizedLiveCommentTaskType,
        running: true,
        paused: false,
        liveCommentControlStatus: "running",
        liveCommentExecutionEnabled: true
      });
      heartbeatService.reportImmediateHeartbeat(counters.currentPhase, currentAgentStatus(), "直播评论已启动");
      uploader.ackCommand(command.id, "DONE", {
        applied: true,
        accepted: true,
        completed: false,
        commandType: commandType,
        taskType: normalizedLiveCommentTaskType,
        message: "live comment command accepted; target room execution continues asynchronously"
      });
      return;
    }
      if (commandType === "PAUSE") {
      syncTaskSchedulerState(payload.taskType, commandType, {
        reason: "backend_live_comment",
        checkpoint: currentCheckpoint({ checkpointType: "backend_live_comment_pause" })
      });
      floatyControl.update({
        running: true,
        paused: true,
        stopRequested: true,
        manualOverride: true,
        liveCommentControlStatus: "paused",
        liveCommentExecutionEnabled: false,
        lastManualAction: "backend_live_comment_pause",
        lastMessage: "直播评论已暂停"
      });
      counters.lastStopReason = "manual_pause";
      logCommandApplied(command, "INFO", {
        taskType: payload.taskType,
        stopRequested: true,
        liveCommentControlStatus: "paused",
        liveCommentExecutionEnabled: false
      });
      heartbeatService.reportImmediateHeartbeat(counters.currentPhase, currentAgentStatus(), "直播评论已暂停");
      uploader.ackCommand(command.id, "DONE", { applied: true, commandType: commandType, taskType: payload.taskType });
      return;
    }
    if (commandType === "STOP") {
      context.liveCommentPriorityRequested = false;
      context.liveCommentTargetRoomRefreshRequested = false;
      counters.lastStopReason = "backend_live_comment_stop";
      syncTaskSchedulerState(payload.taskType, commandType, {
        reason: "backend_live_comment",
        checkpoint: currentCheckpoint({ checkpointType: "backend_live_comment_stop" })
      });
      floatyControl.update({
        running: false,
        paused: true,
        stopRequested: true,
        exitRequested: false,
        manualOverride: true,
        liveCommentControlStatus: "stopped",
        liveCommentExecutionEnabled: false,
        lastManualAction: "backend_live_comment_stop",
        lastMessage: "直播评论已停止"
      });
      logCommandApplied(command, "INFO", {
        taskType: payload.taskType,
        running: false,
        paused: true,
        stopRequested: true,
        exitRequested: false,
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
    config.task.liveTargets = sanitizeLiveTargets(remoteConfig.liveTargets || []);
    var commerceCardLiveComment = pickCommerceCardLiveCommentConfig(remoteConfig);
    if (commerceCardLiveComment) {
      config.task.commerceCardLiveComment = sanitizeCommerceCardLiveCommentConfig(commerceCardLiveComment);
    }
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
      liveTargetCount: config.task.liveTargets.length,
      followedAccountCount: config.task.followedAccounts.length,
      commerceCardLiveEnabled: !!(config.task.commerceCardLiveComment && config.task.commerceCardLiveComment.enabled),
      commerceCardLiveSendApproved: !!(config.task.commerceCardLiveComment && config.task.commerceCardLiveComment.executeEnabled && config.task.commerceCardLiveComment.manualExecutionApproved),
      liveCommentConfigApplied: !!remoteConfig.liveCommentConfig,
      commerceCardLiveConfigApplied: !!commerceCardLiveComment,
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

  function pickCommerceCardLiveCommentConfig(remoteConfig) {
    if (remoteConfig && remoteConfig.commerceCardLiveComment && typeof remoteConfig.commerceCardLiveComment === "object") {
      return remoteConfig.commerceCardLiveComment;
    }
    var p3 = remoteConfig && remoteConfig.p3ExtensionsConfig;
    if (p3 && typeof p3 === "object" && p3.commerceCardLiveComment && typeof p3.commerceCardLiveComment === "object") {
      return p3.commerceCardLiveComment;
    }
    return null;
  }

  function sanitizeLiveTargets(value) {
    if (!value || !value.length) {
      return [];
    }
    var result = [];
    for (var i = 0; i < value.length && result.length < 50; i++) {
      var item = value[i] || {};
      var featureType = item.featureType === "live_comment" || item.featureType === "commerce_card_live_comment" ? item.featureType : "";
      var targetCode = normalizeStringList([item.targetCode || ""], 1, 64)[0] || "";
      var targetName = normalizeStringList([item.targetName || ""], 1, 200)[0] || "";
      if (!featureType || !targetName) {
        continue;
      }
      result.push({
        targetId: normalizeStringList([item.targetId || ""], 1, 64)[0] || "",
        targetCode: targetCode,
        targetName: targetName,
        platform: normalizeStringList([item.platform || "douyin"], 1, 32)[0] || "douyin",
        featureType: featureType,
        enabled: item.enabled !== false,
        similarityThreshold: clampDecimal(item.similarityThreshold, 0.9, 0.5, 1),
        searchKeywords: normalizeStringList(item.searchKeywords || [], 30, 100),
        requiredKeywords: normalizeStringList(item.requiredKeywords || [], 30, 100),
        forbiddenKeywords: normalizeStringList(item.forbiddenKeywords || [], 30, 100),
        productKeywords: normalizeStringList(item.productKeywords || [], 30, 100),
        liveSignals: normalizeStringList(item.liveSignals || [], 30, 100),
        aliases: sanitizeLiveTargetAliases(item.aliases || []),
        runtimeConfig: sanitizeLiveTargetRuntimeConfig(item.runtimeConfig || {})
      });
    }
    return result;
  }

  function sanitizeLiveTargetAliases(value) {
    if (!value || !value.length) {
      return [];
    }
    var result = [];
    for (var i = 0; i < value.length && result.length < 50; i++) {
      var item = value[i] || {};
      var aliasText = normalizeStringList([item.aliasText || ""], 1, 200)[0] || "";
      if (!aliasText) {
        continue;
      }
      result.push({
        aliasText: aliasText,
        aliasType: normalizeStringList([item.aliasType || "room_name"], 1, 32)[0] || "room_name",
        weight: clampNumber(item.weight, 100, 0, 1000),
        enabled: item.enabled !== false
      });
    }
    return result;
  }

  function sanitizeLiveTargetRuntimeConfig(value) {
    value = value || {};
    return {
      executeEnabled: value.executeEnabled === true,
      manualExecutionApproved: value.manualExecutionApproved === true,
      scanMinutesPerRound: clampNumber(value.scanMinutesPerRound, 15, 1, 60),
      watchMinutesPerLive: clampNumber(value.watchMinutesPerLive, 15, 0, 120),
      maxRounds: clampNumber(value.maxRounds, 3, 1, 20),
      maxCommentsPerRoom: clampNumber(value.maxCommentsPerRoom, 1, 0, 5),
      commentPool: normalizeStringList(value.commentPool || [], 50, 80)
    };
  }

  function clampDecimal(value, fallback, minValue, maxValue) {
    var number = Number(value);
    if (!isFinite(number)) {
      number = fallback;
    }
    return Math.max(minValue, Math.min(maxValue, number));
  }

  function sanitizeCommerceCardLiveCommentConfig(value) {
    value = value || {};
    var current = config.task.commerceCardLiveComment || {};
    return {
      enabled: value.enabled === true,
      executeEnabled: value.executeEnabled === true,
      manualExecutionApproved: value.manualExecutionApproved === true,
      searchKeywords: normalizeStringList(value.searchKeywords || current.searchKeywords || [], 20, 50),
      matchKeywords: normalizeStringList(value.matchKeywords || current.matchKeywords || [], 20, 50),
      liveSignals: normalizeStringList(value.liveSignals || current.liveSignals || [], 20, 50),
      scanMinutesPerRound: clampNumber(value.scanMinutesPerRound, current.scanMinutesPerRound || 15, 1, 60),
      watchMinutesPerLive: clampNumber(value.watchMinutesPerLive, current.watchMinutesPerLive || 15, 0, 120),
      maxRounds: clampNumber(value.maxRounds, current.maxRounds || 3, 1, 20),
      maxCommentsPerRoom: clampNumber(value.maxCommentsPerRoom, current.maxCommentsPerRoom || 1, 0, 5),
      commentPool: normalizeStringList(value.commentPool || current.commentPool || [], 50, 80)
    };
  }
}

module.exports = {
  createControlLoop: createControlLoop
};
