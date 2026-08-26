// 职责：拦截养号命令，在独立线程执行并保持 STOP 命令可轮询。
function createAccountWarmupCommandBridge(context) {
  var uploader = context.uploader;
  var logger = context.logger || { info: function () {}, warn: function () {}, error: function () {} };
  var active = null;
  var registry = null;
  var stopCleanup = null;
  var preloadError = null;
  var stopCleanupPreloadError = null;
  var lastVideoStop = null;
  var installed = false;
  var originalPoll = null;

  function preloadRegistry() {
    if (registry) return registry;
    var loaders = [
      { name: "业务脚本热更新层", load: context.loadBizScript },
      { name: "APK 基础层", load: context.loadBaselineScript }
    ];
    for (var index = 0; index < loaders.length; index += 1) {
      var loader = loaders[index];
      if (typeof loader.load !== "function") continue;
      try {
        var registryModule = loader.load("features/account-warmup/registry.js");
        registry = registryModule.createAccountWarmupRegistry(context);
        preloadError = null;
        logger.info("养号模块预加载完成", { featureKey: "target_live_interaction", source: loader.name });
        return registry;
      } catch (error) {
        preloadError = error;
        logger.warn("养号模块预加载失败，尝试下一层", { source: loader.name, message: String(error) });
      }
    }
    logger.error("养号模块预加载失败", { message: String(preloadError || "") });
    return null;
  }

  function preloadStopCleanup() {
    if (stopCleanup) return stopCleanup;
    var cleanupPath = "features/publish-video/douyin-post-publish-cleanup.js";
    var loaders = [
      { name: "业务脚本热更新层", load: context.loadBizScript },
      { name: "APK 基础层", load: context.loadBaselineScript }
    ];
    for (var index = 0; index < loaders.length; index += 1) {
      var loader = loaders[index];
      if (typeof loader.load !== "function") continue;
      try {
        var cleanupModule = loader.load(cleanupPath);
        if (!cleanupModule || typeof cleanupModule.createDouyinPostPublishCleanup !== "function") continue;
        stopCleanup = cleanupModule.createDouyinPostPublishCleanup({
          logger: logger,
          cooldownMs: 0,
          isPublishing: function () { return false; }
        });
        stopCleanupPreloadError = null;
        logger.info("养号停止清理器预加载完成", { source: loader.name });
        return stopCleanup;
      } catch (error) {
        stopCleanupPreloadError = error;
        logger.warn("养号停止清理器加载失败，尝试下一层", { source: loader.name, message: String(error) });
      }
    }
    logger.error("养号停止清理器预加载失败", { message: String(stopCleanupPreloadError || "") });
    return null;
  }

  function startThread(runner) {
    if (context.startThread) return context.startThread(runner);
    if (typeof threads !== "undefined" && threads.start) return threads.start(runner);
    return runner();
  }

  function ack(command, status, result) {
    return uploader.ackCommand(command.id, status, result || {});
  }

  function reportStage(runState, event) {
    if (!runState || runState.terminal || runState.stopRequested || !active || active.commandId !== runState.commandId) {
      return;
    }
    event = event || {};
    var stage = String(event.stage || "").trim();
    if (!stage) return;
    runState.stageHistory.push(stage);
    if (runState.stageHistory.length > 20) {
      runState.stageHistory.splice(0, runState.stageHistory.length - 20);
    }
    var progress = {
      featureKey: runState.featureKey,
      batchId: runState.batchId,
      stage: stage,
      stageHistory: runState.stageHistory.slice()
    };
    Object.keys(event).forEach(function (key) {
      if (key !== "stage" && key !== "stageHistory" && event[key] !== undefined) {
        progress[key] = event[key];
      }
    });
    // Later stages such as SWIPING_COMMENTS do not repeat the candidate list.
    // Keep the latest partial capture so a concurrent manual STOP cannot erase
    // comments already acknowledged by the device.
    if (runState.featureKey === "live_comment_entry" && runState.latestProgress) {
      if (!Array.isArray(progress.comments) && Array.isArray(runState.latestProgress.comments)) {
        progress.comments = runState.latestProgress.comments;
      }
      if (progress.commentCount === undefined && runState.latestProgress.commentCount !== undefined) {
        progress.commentCount = runState.latestProgress.commentCount;
      }
      if (progress.commentSourceCount === undefined && runState.latestProgress.commentSourceCount !== undefined) {
        progress.commentSourceCount = runState.latestProgress.commentSourceCount;
      }
    }
    if (runState.featureKey === "live_comment_entry") runState.latestProgress = progress;
    try {
      ack(runState.command, "RUNNING", progress);
    } catch (error) {
      logger.warn("养号阶段进度回执失败", {
        commandId: runState.commandId,
        stage: stage,
        message: String(error)
      });
    }
  }

  function interruptWorker(runState) {
    if (!runState || !runState.thread || typeof runState.thread.interrupt !== "function") return false;
    try {
      runState.thread.interrupt();
      logger.info("养号停止命令已中断业务线程", { commandId: runState.commandId });
      return true;
    } catch (error) {
      logger.warn("养号停止命令中断业务线程失败", { commandId: runState.commandId, message: String(error) });
      return false;
    }
  }

  function cleanupImmediatelyAfterStop(runState) {
    if (runState.stopCleanupStarted) {
      return runState.stopCleanupResult || { completed: false, reason: "STOP_CLEANUP_IN_PROGRESS" };
    }
    runState.stopCleanupStarted = true;
    var cleanupResult = null;
    try {
      cleanupResult = stopCleanup
        ? stopCleanup.run({ taskId: runState.commandId, batchId: runState.batchId })
        : {
          completed: false,
          reason: "STOP_CLEANUP_UNAVAILABLE",
          message: String(stopCleanupPreloadError || "")
        };
    } catch (error) {
      cleanupResult = { completed: false, reason: "STOP_CLEANUP_FAILED", message: String(error) };
    }
    runState.stopCleanupResult = cleanupResult || { completed: false, reason: "STOP_CLEANUP_EMPTY_RESULT" };
    logger.info("养号停止命令手机清理完成", {
      commandId: runState.commandId,
      cleanupCompleted: !!runState.stopCleanupResult.completed,
      cleanupReason: String(runState.stopCleanupResult.reason || "")
    });
    return runState.stopCleanupResult;
  }

  function preserveLiveEntryProgress(runState, result) {
    result = result || {};
    if (!runState || runState.featureKey !== "live_comment_entry") return result;
    var preserved = {};
    Object.keys(result).forEach(function (key) { preserved[key] = result[key]; });
    preserved.featureKey = runState.featureKey;
    preserved.batchId = runState.batchId;
    preserved.stageHistory = runState.stageHistory.slice();
    if (!preserved.stage && preserved.stageHistory.length) {
      preserved.stage = preserved.stageHistory[preserved.stageHistory.length - 1];
    }
    return preserved;
  }

  function finishCommand(command, status, result) {
    if (!active || active.commandId !== command.id) return false;
    result = preserveLiveEntryProgress(active, result);
    active.terminal = { status: status, result: result || {} };
    var response;
    try {
      response = ack(command, status, result);
    } catch (error) {
      logger.warn("养号任务回执失败", { commandId: command.id, message: String(error) });
      return false;
    }
    if (response && response.success === false) {
      logger.warn("养号任务回执待重试", { commandId: command.id, message: String(response.message || "") });
      return false;
    }
    active = null;
    return true;
  }

  function requiresImmediateCleanup(result) {
    return !!(result && (
      result.reasonCode === "PLATFORM_VERIFICATION" ||
      result.status === "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION" ||
      result.cleanupRequired === true
    ));
  }

  function liveEntryStopResult(runState, cleanupResult) {
    var progress = runState && runState.latestProgress || {};
    var result = {
      status: "LIVE_COMMENT_ENTRY_STOPPED",
      stage: "STOPPED",
      targetCommandId: runState && runState.commandId,
      cleanup: cleanupResult
    };
    if (Array.isArray(progress.comments)) {
      result.comments = progress.comments;
      result.commentCount = progress.comments.length;
      result.captureStatus = "LIVE_COMMENT_ENTRY_PARTIAL";
      result.captureCompleted = false;
    } else if (progress.commentCount !== undefined) {
      result.commentCount = progress.commentCount;
    }
    if (progress.commentSourceCount !== undefined) result.commentSourceCount = progress.commentSourceCount;
    return result;
  }

  function runCommand(command) {
    var payload = command.payload || command.payloadJson || {};
    if (active) {
      if (active.commandId === command.id) {
        if (active.terminal) finishCommand(command, active.terminal.status, active.terminal.result);
        return;
      }
      ack(command, "FAILED", { status: "ACCOUNT_WARMUP_BUSY", message: "当前设备已有养号任务执行中" });
      return;
    }
    var runState = {
      commandId: command.id,
      batchId: String(payload.batchId || ""),
      featureKey: String(payload.featureKey || ""),
      stopRequested: false,
      stopCleanupStarted: false,
      stageHistory: [],
      latestProgress: null,
      command: command,
      thread: null
    };
    active = runState;
    logger.info("养号任务启动", {
      commandId: command.id,
      batchId: runState.batchId,
      featureKey: String(payload.featureKey || "")
    });
    var thread = startThread(function () {
      try {
        if (!registry) throw preloadError || new Error("account warmup registry is not preloaded");
        var task = registry.create(String(payload.featureKey || ""), {
          logger: logger,
          reportStage: function (event) { reportStage(runState, event); }
        });
        var runPayload = {};
        var config = payload.config || {};
        for (var key in config) {
          if (Object.prototype.hasOwnProperty.call(config, key)) runPayload[key] = config[key];
        }
        runPayload.batchId = runState.batchId;
        var result = task.run(runPayload, {
          shouldStop: function () { return !!runState.stopRequested; }
        });
        if (requiresImmediateCleanup(result)) {
          runState.stopRequested = true;
          result.cleanup = cleanupImmediatelyAfterStop(runState);
        }
        if (runState.featureKey === "live_comment_entry" && result && result.status === "STOPPED") {
          result.status = "LIVE_COMMENT_ENTRY_STOPPED";
        }
        var done = result && (
          result.status === "TARGET_LIVE_ENTERED" ||
          result.status === "VIDEO_WARMUP_DOUYIN_OPENED" ||
          result.status === "LIVE_COMMENT_ENTRY_ENTERED" ||
          result.status === "LIVE_COMMENT_ENTRY_CAPTURED" ||
          result.status === "LIVE_COMMENT_ENTRY_STOPPED" ||
          result.status === "STOPPED"
        );
        finishCommand(command, done ? "DONE" : "FAILED", result || { status: "FAILED" });
      } catch (error) {
        if (runState.stopRequested) return;
        logger.error("养号任务失败", { commandId: command.id, message: String(error) });
        finishCommand(command, "FAILED", { status: "FAILED", message: String(error) });
      }
    });
    if (active === runState) runState.thread = thread;
  }

  function stopCommand(command) {
    var payload = command.payload || command.payloadJson || {};
    var matches = !!(active &&
      active.commandId === String(payload.targetCommandId || "") &&
      active.batchId === String(payload.batchId || ""));
    if (!matches) {
      ack(command, "IGNORED", {
        status: "NO_ACTIVE_WARMUP_TASK",
        targetCommandId: String(payload.targetCommandId || "")
      });
      return;
    }
    var runState = active;
    runState.stopRequested = true;
    interruptWorker(runState);
    var cleanupResult = cleanupImmediatelyAfterStop(runState);
    var runStopResult = runState.featureKey === "live_comment_entry"
      ? liveEntryStopResult(runState, cleanupResult)
      : { status: "STOPPED", cleanup: cleanupResult };
    ack(command, "DONE", runState.featureKey === "live_comment_entry"
      ? runStopResult
      : {
        status: "STOPPED",
        targetCommandId: String(payload.targetCommandId || ""),
        cleanup: cleanupResult
      });
    finishCommand(runState.command, "DONE", runStopResult);
  }

  function videoStopCommand(command) {
    var payload = command.payload || command.payloadJson || {};
    var batchId = String(payload.batchId || "");
    var featureKey = String(payload.featureKey || "");
    var matches = !!(active &&
      featureKey === "video_warmup" &&
      active.featureKey === "video_warmup" &&
      active.batchId === batchId);
    if (!matches) {
      if (lastVideoStop && featureKey === "video_warmup" && lastVideoStop.batchId === batchId) {
        ack(command, "DONE", {
          status: "ALREADY_STOPPED",
          targetCommandId: lastVideoStop.commandId
        });
        return;
      }
      ack(command, "IGNORED", {
        status: active && active.featureKey === "video_warmup"
          ? "VIDEO_WARMUP_BATCH_MISMATCH"
          : "NO_ACTIVE_VIDEO_WARMUP_TASK",
        batchId: batchId
      });
      return;
    }
    var runState = active;
    runState.stopRequested = true;
    interruptWorker(runState);
    var cleanupResult = cleanupImmediatelyAfterStop(runState);
    lastVideoStop = { batchId: runState.batchId, commandId: runState.commandId };
    ack(command, "DONE", {
      status: "STOPPED",
      targetCommandId: runState.commandId,
      cleanup: cleanupResult
    });
    finishCommand(runState.command, "DONE", { status: "STOPPED", cleanup: cleanupResult });
  }

  function intercept(commands) {
    var passthrough = [];
    commands = commands || [];
    for (var i = 0; i < commands.length; i++) {
      var command = commands[i];
      if (command.commandType === "ACCOUNT_WARMUP_RUN") {
        runCommand(command);
      } else if (command.commandType === "ACCOUNT_WARMUP_STOP") {
        stopCommand(command);
      } else if (command.commandType === "VIDEO_WARMUP_STOP") {
        videoStopCommand(command);
      } else {
        passthrough.push(command);
      }
    }
    return passthrough;
  }

  function install() {
    if (installed) return false;
    preloadStopCleanup();
    preloadRegistry();
    originalPoll = uploader.pollCommands;
    uploader.pollCommands = function () {
      return intercept(originalPoll.apply(uploader, arguments));
    };
    installed = true;
    return true;
  }

  return {
    install: install,
    preload: preloadRegistry,
    intercept: intercept,
    getActive: function () { return active; }
  };
}

module.exports = {
  createAccountWarmupCommandBridge: createAccountWarmupCommandBridge
};
