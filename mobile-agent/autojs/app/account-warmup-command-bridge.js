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
    try {
      var registryModule = context.loadBizScript("features/account-warmup/registry.js");
      registry = registryModule.createAccountWarmupRegistry(context);
      preloadError = null;
      logger.info("养号模块预加载完成", { featureKey: "target_live_interaction" });
      return registry;
    } catch (error) {
      preloadError = error;
      logger.error("养号模块预加载失败", { message: String(error) });
      return null;
    }
  }

  function preloadStopCleanup() {
    if (stopCleanup) return stopCleanup;
    try {
      var cleanupModule = context.loadBaselineScript("features/publish-video/douyin-post-publish-cleanup.js");
      stopCleanup = cleanupModule.createDouyinPostPublishCleanup({
        logger: logger,
        cooldownMs: 0,
        isPublishing: function () { return false; }
      });
      stopCleanupPreloadError = null;
      logger.info("养号停止清理器已从 APK 基础层预加载", {});
      return stopCleanup;
    } catch (error) {
      stopCleanupPreloadError = error;
      logger.error("养号停止清理器预加载失败", { message: String(error) });
      return null;
    }
  }

  function startThread(runner) {
    if (context.startThread) return context.startThread(runner);
    if (typeof threads !== "undefined" && threads.start) return threads.start(runner);
    return runner();
  }

  function ack(command, status, result) {
    return uploader.ackCommand(command.id, status, result || {});
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
    logger.info("养号停止命令手机清理完成", {
      commandId: runState.commandId,
      cleanupCompleted: !!(cleanupResult && cleanupResult.completed),
      cleanupReason: String(cleanupResult && cleanupResult.reason || "")
    });
    return cleanupResult || { completed: false, reason: "STOP_CLEANUP_EMPTY_RESULT" };
  }

  function finishCommand(command, status, result) {
    if (!active || active.commandId !== command.id) return false;
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
        var task = registry.create(String(payload.featureKey || ""), { logger: logger });
        var runPayload = {};
        var config = payload.config || {};
        for (var key in config) {
          if (Object.prototype.hasOwnProperty.call(config, key)) runPayload[key] = config[key];
        }
        runPayload.batchId = runState.batchId;
        var result = task.run(runPayload, {
          shouldStop: function () { return !!runState.stopRequested; }
        });
        var done = result && (
          result.status === "TARGET_LIVE_ENTERED" ||
          result.status === "VIDEO_WARMUP_DOUYIN_OPENED" ||
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
    runState.stopCleanupStarted = true;
    interruptWorker(runState);
    var cleanupResult = cleanupImmediatelyAfterStop(runState);
    ack(command, "DONE", {
      status: "STOPPED",
      targetCommandId: String(payload.targetCommandId || ""),
      cleanup: cleanupResult
    });
    finishCommand(runState.command, "DONE", {
      status: "STOPPED",
      cleanup: cleanupResult
    });
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
    runState.stopCleanupStarted = true;
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
