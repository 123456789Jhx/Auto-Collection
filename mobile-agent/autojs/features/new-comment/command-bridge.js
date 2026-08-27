"use strict";

var createCommandAckOutbox = require("./command-ack-outbox.js").createCommandAckOutbox;
var FEATURE_KEY = "isolated_live_comment_entry";
var ENTRY_PATH = "features/new-comment/index.js";
var CACHE_LIMIT = 20;

function createNewCommentCommandBridge(context) {
  context = context || {};
  var uploader = context.uploader;
  var logger = context.logger || { info: function () {}, warn: function () {}, error: function () {} };
  var entryModule = null;
  var preloadError = null;
  var active = null;
  var terminalCache = {};
  var terminalKeys = [];
  var stoppedRuns = {};
  var stoppedKeys = [];
  var installed = false;
  var originalPoll = null;
  var pollMetadata = null;
  var metadataPreserverInstalled = false;
  var ackOutbox = createCommandAckOutbox({
    limit: CACHE_LIMIT,
    flushLimit: 4,
    send: function (commandId, status, result) { return uploader.ackCommand(commandId, status, result); }
  });

  function featureValue(payload) {
    return typeof (payload && payload.featureKey) === "string" ? payload.featureKey.trim() : "";
  }
  function batchValue(payload) {
    return typeof (payload && payload.batchId) === "string" ? payload.batchId.trim() : "";
  }
  function payloadOf(command) {
    return command && (command.payload || command.payloadJson) || {};
  }
  function loadEntry() {
    if (entryModule) return entryModule;
    var loaders = [
      { name: "业务脚本热更新层", load: context.loadBizScript },
      { name: "APK 基础层", load: context.loadBaselineScript }
    ];
    for (var index = 0; index < loaders.length; index += 1) {
      if (typeof loaders[index].load !== "function") continue;
      try {
        var loaded = loaders[index].load(ENTRY_PATH);
        if (!loaded || typeof loaded.createIsolatedLiveCommentEntryTask !== "function") {
          throw new Error("isolated comment entry factory is missing");
        }
        entryModule = loaded;
        preloadError = null;
        logger.info("隔离评论入口预加载完成", { featureKey: FEATURE_KEY, source: loaders[index].name });
        return entryModule;
      } catch (error) {
        preloadError = error;
        logger.warn("隔离评论入口预加载失败，尝试下一层", {
          featureKey: FEATURE_KEY, source: loaders[index].name, message: String(error)
        });
      }
    }
    logger.error("隔离评论入口预加载失败", { featureKey: FEATURE_KEY, message: String(preloadError || "") });
    return null;
  }
  function startThread(runner) {
    if (typeof context.startThread === "function") return context.startThread(runner);
    if (typeof threads !== "undefined" && threads.start) return threads.start(runner);
    return runner();
  }
  function withContract(runState, result) {
    var output = {};
    Object.keys(result || {}).forEach(function (key) { output[key] = result[key]; });
    output.featureKey = runState ? runState.featureKey : featureValue(result);
    output.batchId = runState ? runState.batchId : batchValue(result);
    return output;
  }
  function ack(command, status, result, runState) {
    return uploader.ackCommand(command.id, status, withContract(runState || {
      featureKey: featureValue(payloadOf(command)), batchId: batchValue(payloadOf(command))
    }, result));
  }
  function reliableAck(key, command, status, result, runState, logMessage, onDelivered) {
    var contracted = withContract(runState || {
      featureKey: featureValue(payloadOf(command)), batchId: batchValue(payloadOf(command))
    }, result);
    return ackOutbox.submit({
      key: key, commandId: command.id, status: status, result: contracted, onDelivered: onDelivered,
      onFailure: function (error) {
        logger.warn(logMessage, { featureKey: contracted.featureKey, batchId: contracted.batchId,
          commandId: String(command.id || ""), message: String(error) });
      }
    });
  }
  function ackSucceeded(response) {
    return !(response && response.success === false);
  }
  function remember(cache, keys, key, value) {
    if (!Object.prototype.hasOwnProperty.call(cache, key)) keys.push(key);
    cache[key] = value;
    while (keys.length > CACHE_LIMIT) delete cache[keys.shift()];
  }
  function routeMismatch(command) {
    var payload = payloadOf(command);
    var detail = {
      commandType: String(command.commandType || ""),
      commandId: String(command.id || ""),
      featureKey: featureValue(payload),
      batchId: batchValue(payload),
      deviceId: String(context.config && context.config.device && context.config.device.deviceId || ""),
      requestTime: String(command.requestTime || command.createdAt || new Date().toISOString())
    };
    logger.error("隔离评论错路由已拒绝", detail);
    reliableAck("route:" + command.id, command, "FAILED", {
      status: "ROUTE_MISMATCH", reasonCode: "ROUTE_MISMATCH", message: "隔离评论任务路由不匹配"
    }, null, "隔离评论错路由回执失败");
  }
  function validExactRun(payload) {
    return payload.featureKey === FEATURE_KEY && batchValue(payload) && payload.config &&
      typeof payload.config === "object" && !Array.isArray(payload.config) &&
      typeof payload.config.targetKeyword === "string" && !!payload.config.targetKeyword.trim();
  }
  function isIsolatedIntent(payload) {
    return featureValue(payload).indexOf("isolated_") === 0;
  }
  function busy(command) {
    var payload = payloadOf(command);
    logger.warn("隔离评论任务互斥拦截", {
      featureKey: featureValue(payload), commandId: String(command.id || ""), batchId: batchValue(payload)
    });
    reliableAck("busy:" + command.id, command, "FAILED", {
      status: "ACCOUNT_WARMUP_BUSY", reasonCode: "ACCOUNT_WARMUP_BUSY", message: "当前设备已有任务执行中"
    }, null, "隔离评论互斥回执失败");
  }
  function preserveProgress(runState, result) {
    var output = withContract(runState, result || {});
    var progress = runState.latestProgress || {};
    ["comments", "commentCount", "commentSourceCount"].forEach(function (key) {
      if (output[key] === undefined && progress[key] !== undefined) output[key] = progress[key];
    });
    output.stageHistory = runState.stageHistory.slice();
    if (!output.stage && output.stageHistory.length) output.stage = output.stageHistory[output.stageHistory.length - 1];
    return output;
  }
  function reportStage(runState, event) {
    if (!runState || runState.terminal || runState.stopRequested || active !== runState) return;
    ackOutbox.flush();
    event = event || {};
    var stage = String(event.stage || "").trim();
    if (!stage) return;
    runState.stageHistory.push(stage);
    if (runState.stageHistory.length > CACHE_LIMIT) runState.stageHistory.shift();
    var progress = preserveProgress(runState, event);
    progress.stage = stage;
    runState.latestProgress = progress;
    try {
      var response = ack(runState.command, "RUNNING", progress, runState);
      if (!ackSucceeded(response)) throw new Error(String(response.message || "RUNNING_ACK_REJECTED"));
    } catch (error) {
      logger.warn("隔离评论阶段进度回执失败", {
        featureKey: FEATURE_KEY, batchId: runState.batchId, commandId: runState.commandId,
        stage: stage, message: String(error)
      });
    }
  }
  function cacheTerminal(runState) {
    remember(terminalCache, terminalKeys, runState.commandId, runState.terminal);
  }
  function finish(runState, status, result) {
    if (!runState.terminal) runState.terminal = { status: status, result: preserveProgress(runState, result) };
    return reliableAck("run:" + runState.commandId, runState.command, runState.terminal.status,
      runState.terminal.result, runState, "隔离评论终态回执失败", function () {
        cacheTerminal(runState);
        if (active === runState) active = null;
      });
  }
  function interrupt(runState) {
    if (!runState.thread || typeof runState.thread.interrupt !== "function") return false;
    try { runState.thread.interrupt(); return true; }
    catch (error) {
      logger.warn("隔离评论线程中断失败", {
        featureKey: FEATURE_KEY, batchId: runState.batchId,
        commandId: runState.commandId, message: String(error)
      });
      return false;
    }
  }
  function cleanup(runState) {
    if (runState.cleanupStarted) return runState.cleanupResult;
    runState.cleanupStarted = true;
    try {
      runState.cleanupResult = runState.task && runState.task.cleanup &&
        typeof runState.task.cleanup.run === "function" ? runState.task.cleanup.run({
          taskId: runState.commandId, batchId: runState.batchId, control: runState.control
        }) : { completed: false, reason: "ISOLATED_CLEANUP_UNAVAILABLE" };
    } catch (error) {
      runState.cleanupResult = { completed: false, reason: "ISOLATED_CLEANUP_FAILED", message: String(error) };
    }
    return runState.cleanupResult;
  }
  function needsCleanup(result) {
    return !!(result && (result.cleanupRequired === true || result.reasonCode === "PLATFORM_VERIFICATION" ||
      result.status === "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION"));
  }
  function normalizeWorkerResult(result) {
    result = result || { status: "FAILED" };
    if (result.status === "STOPPED") result.status = "LIVE_COMMENT_ENTRY_STOPPED";
    return result;
  }
  function workerStatus(result) {
    return result && (result.status === "LIVE_COMMENT_ENTRY_ENTERED" ||
      result.status === "LIVE_COMMENT_ENTRY_CAPTURED" || result.status === "LIVE_COMMENT_ENTRY_STOPPED") ? "DONE" : "FAILED";
  }
  function retryCached(command, terminal) {
    reliableAck("run:" + command.id, command, terminal.status, terminal.result, {
      featureKey: terminal.result.featureKey, batchId: terminal.result.batchId
    }, "隔离评论缓存终态回执失败");
  }

  function runCommand(command) {
    if (active && active.commandId === command.id) {
      if (active.terminal) finish(active, active.terminal.status, active.terminal.result);
      return;
    }
    if (terminalCache[command.id]) { retryCached(command, terminalCache[command.id]); return; }
    var oldActive = context.accountWarmupCommandBridge &&
      typeof context.accountWarmupCommandBridge.getActive === "function" && context.accountWarmupCommandBridge.getActive();
    if (active || oldActive) { busy(command); return; }
    var payload = payloadOf(command);
    var runState = {
      command: command, commandId: String(command.id || ""), featureKey: FEATURE_KEY,
      batchId: batchValue(payload), stopRequested: false, cleanupStarted: false,
      stopCompleted: false, stageHistory: [], latestProgress: null, terminal: null, thread: null, task: null
    };
    runState.control = { shouldStop: function () { return !!runState.stopRequested; } };
    active = runState;
    try {
      var module = loadEntry();
      if (!module) throw preloadError || new Error("isolated comment entry is unavailable");
      runState.task = module.createIsolatedLiveCommentEntryTask(context, {
        reportStage: function (event) { reportStage(runState, event); }
      });
    } catch (error) {
      finish(runState, "FAILED", { status: "FAILED", reasonCode: "ENTRY_LOAD_FAILED", message: String(error) });
      return;
    }
    logger.info("隔离评论任务启动", {
      featureKey: FEATURE_KEY, commandId: runState.commandId, batchId: runState.batchId
    });
    var runPayload = {};
    Object.keys(payload.config || {}).forEach(function (key) { runPayload[key] = payload.config[key]; });
    runPayload.batchId = runState.batchId;
    var runner = function () {
      try {
        var result = normalizeWorkerResult(runState.task.run(runPayload, runState.control));
        if (runState.stopCompleted || runState.terminal) return;
        var status = workerStatus(result);
        if (status === "FAILED" || needsCleanup(result)) result.cleanup = cleanup(runState);
        finish(runState, status, result);
      } catch (error) {
        if (runState.stopCompleted || runState.terminal) return;
        logger.error("隔离评论任务失败", {
          featureKey: FEATURE_KEY, batchId: runState.batchId,
          commandId: runState.commandId, message: String(error)
        });
        finish(runState, "FAILED", {
          status: "FAILED", message: String(error), cleanup: cleanup(runState)
        });
      }
    };
    try { runState.thread = startThread(runner); }
    catch (startError) {
      var startFailure = { status: "FAILED", reasonCode: "THREAD_START_FAILED",
        message: String(startError), cleanup: cleanup(runState) };
      logger.error("隔离评论线程启动失败", { featureKey: FEATURE_KEY, batchId: runState.batchId,
        commandId: runState.commandId, message: String(startError) });
      finish(runState, "FAILED", startFailure);
    }
  }

  function stoppedKey(targetCommandId, batchId) {
    return String(targetCommandId || "") + "\n" + String(batchId || "");
  }

  function stoppedResult(runState, status) {
    var result = preserveProgress(runState, {
      status: status || "LIVE_COMMENT_ENTRY_STOPPED", stage: "STOPPED",
      targetCommandId: runState.commandId, cleanup: runState.cleanupResult
    });
    result.captureStatus = "LIVE_COMMENT_ENTRY_PARTIAL";
    result.captureCompleted = false;
    return result;
  }

  function ackStop(command, result, runState) {
    reliableAck("stop:" + command.id, command, "DONE", result, runState, "隔离评论停止回执失败");
  }

  function alreadyCompletedResult(targetCommandId, terminal) {
    return { status: "ALREADY_COMPLETED", targetCommandId: targetCommandId,
      targetStatus: String(terminal && terminal.result && terminal.result.status || "") };
  }

  function stopCommand(command) {
    var payload = payloadOf(command);
    var key = stoppedKey(payload.targetCommandId, payload.batchId);
    if (stoppedRuns[key]) {
      ackStop(command, stoppedResult(stoppedRuns[key], "ALREADY_STOPPED"), stoppedRuns[key]);
      return true;
    }
    var targetId = String(payload.targetCommandId || "");
    var targetBatch = batchValue(payload);
    if (active && active.commandId === targetId && active.batchId === targetBatch && active.terminal) {
      ackStop(command, alreadyCompletedResult(targetId, active.terminal), active);
      return true;
    }
    var cached = terminalCache[targetId];
    if (cached && String(cached.result.batchId || "") === targetBatch) {
      ackStop(command, alreadyCompletedResult(targetId, cached), {
        featureKey: cached.result.featureKey, batchId: cached.result.batchId
      });
      return true;
    }
    if (!active || active.commandId !== String(payload.targetCommandId || "") ||
        active.batchId !== batchValue(payload)) return false;
    var runState = active;
    runState.stopRequested = true;
    interrupt(runState);
    cleanup(runState);
    runState.stopCompleted = true;
    remember(stoppedRuns, stoppedKeys, key, runState);
    var result = stoppedResult(runState);
    ackStop(command, result, runState);
    finish(runState, "DONE", result);
    return true;
  }

  function copyArrayProperties(source, target) {
    Object.keys(source || {}).forEach(function (key) {
      if (!/^\d+$/.test(key)) target[key] = source[key];
    });
    return target;
  }

  function intercept(commands) {
    commands = Array.isArray(commands) ? commands : [];
    var passthrough = [];
    var isolatedReserved = commands.some(function (item) {
      return item && item.commandType === "ACCOUNT_WARMUP_RUN" && validExactRun(payloadOf(item));
    });
    for (var index = 0; index < commands.length; index += 1) {
      var command = commands[index] || {};
      var payload = payloadOf(command);
      if (command.commandType === "ACCOUNT_WARMUP_RUN") {
        if (featureValue(payload) === FEATURE_KEY) {
          if (!validExactRun(payload)) routeMismatch(command);
          else runCommand(command);
        } else if (isIsolatedIntent(payload)) routeMismatch(command);
        else if (active || isolatedReserved) busy(command);
        else passthrough.push(command);
      } else if (command.commandType === "ACCOUNT_WARMUP_STOP" && stopCommand(command)) {
      } else passthrough.push(command);
    }
    return copyArrayProperties(commands, passthrough);
  }

  function install() {
    if (installed) return false;
    loadEntry();
    originalPoll = uploader.pollCommands;
    uploader.pollCommands = function () {
      ackOutbox.flush();
      if (ackOutbox.size() >= CACHE_LIMIT - 1) { pollMetadata = {}; return []; }
      var commands = originalPoll.apply(uploader, arguments);
      pollMetadata = copyArrayProperties(commands, {});
      return intercept(commands);
    };
    installed = true;
    return true;
  }

  function installPollMetadataPreserver() {
    if (!installed || metadataPreserverInstalled) return false;
    var wrappedPoll = uploader.pollCommands;
    uploader.pollCommands = function () {
      pollMetadata = null;
      var commands = wrappedPoll.apply(uploader, arguments);
      return copyArrayProperties(pollMetadata, commands);
    };
    metadataPreserverInstalled = true;
    return true;
  }

  return { install: install, installPollMetadataPreserver: installPollMetadataPreserver,
    intercept: intercept, getActive: function () { return active; } };
}

module.exports = { createNewCommentCommandBridge: createNewCommentCommandBridge };
