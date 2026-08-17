// 原中文名：发布视频-入口.js；职责：协调素材下载、抖音/视频号发布与结果回传。
function loadBizModule(context, path) {
  var moduleCache = context.publishModuleCache;
  if (moduleCache && Object.prototype.hasOwnProperty.call(moduleCache, path)) {
    return moduleCache[path];
  }
  if (context.allowPublishModuleLoad === false) {
    throw new Error("publish module cache miss: " + path);
  }
  var loadedModule;
  if (context.forceBaselineBizScripts && context.loadBaselineScript) {
    loadedModule = context.loadBaselineScript(path);
  } else if (context.loadBizScript) {
    loadedModule = context.loadBizScript(path);
  } else if (context.loadBaselineScript) {
    loadedModule = context.loadBaselineScript(path);
  } else {
    loadedModule = require(files.join(context.config.runtime.scriptDir, path));
  }
  if (moduleCache) moduleCache[path] = loadedModule;
  return loadedModule;
}

function bytesToHex(bytes) {
  var result = "";
  for (var i = 0; i < bytes.length; i++) {
    var value = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    result += (value < 16 ? "0" : "") + value.toString(16);
  }
  return result;
}

function sha256Hex(value) {
  var digest = java.security.MessageDigest.getInstance("SHA-256");
  digest.update(new java.lang.String(value || "").getBytes("UTF-8"));
  return bytesToHex(digest.digest());
}

function hmacSha256Hex(secret, value) {
  var mac = javax.crypto.Mac.getInstance("HmacSHA256");
  var key = new javax.crypto.spec.SecretKeySpec(
    new java.lang.String(secret || "").getBytes("UTF-8"),
    "HmacSHA256"
  );
  mac.init(key);
  return bytesToHex(mac.doFinal(new java.lang.String(value || "").getBytes("UTF-8")));
}

function signedHeaders(config, url, bodyText, method) {
  var timestamp = new Date().toISOString();
  var bodyHash = sha256Hex(bodyText);
  var uri = android.net.Uri.parse(url);
  var canonical = [
    method || "POST",
    uri.getEncodedPath() || "/",
    uri.getEncodedQuery() || "",
    timestamp,
    bodyHash
  ].join("\n");
  return {
    "X-Device-Id": config.device.deviceId || "",
    "X-Device-Token": config.device.deviceToken || "",
    "X-Timestamp": timestamp,
    "X-Body-SHA256": bodyHash,
    "X-Signature": hmacSha256Hex(config.device.deviceToken || "", canonical)
  };
}

function createResultReporter(config) {
  return {
    report: function (taskId, result) {
      var baseUrl = String(config.upload.baseUrl || "").replace(/\/$/, "");
      var url = baseUrl + "/mobile/publish-tasks/" + encodeURIComponent(taskId) + "/result";
      var bodyText = JSON.stringify(result);
      var response = http.postJson(url, result, {
        timeout: config.upload.timeoutMs,
        headers: signedHeaders(config, url, bodyText)
      });
      var responseBody = response.body ? response.body.string() : "";
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error("发布结果回传失败：" + response.statusCode + " " + responseBody.slice(0, 160));
      }
      return { success: true, statusCode: response.statusCode, body: responseBody };
    }
  };
}

function createDefaultSteps(context, injectedUi) {
  var ui = injectedUi || loadBizModule(context, "features/publish-video/douyin-publish-ui.js")
    .createDouyinPublishUi(context);
  var materialDomain = loadBizModule(context, "domain/material-inspector.js");
  return {
    ui: ui,
    open: loadBizModule(context, "features/publish-video/open-douyin-camera.js")
      .createOpenDouyinCameraStep(ui),
    select: loadBizModule(context, "features/publish-video/select-publish-material.js")
      .createSelectPublishMaterialStep(ui, materialDomain.chooseVideoMaterial),
    editCover: loadBizModule(context, "features/publish-video/edit-cover.js")
      .createEditCoverStep(ui),
    fill: loadBizModule(context, "features/publish-video/fill-publish-text.js")
      .createFillPublishTextStep(ui),
    publish: loadBizModule(context, "features/publish-video/execute-publish.js")
      .createExecutePublishStep(ui),
    states: ui.states
  };
}

function isWechatChannelsTask(payload) {
  var platform = String(payload && (payload.platform || payload.platformName || payload.targetPlatform) || "")
    .replace(/-/g, "_")
    .toUpperCase();
  return platform === "WECHAT_CHANNELS" || platform === "CHANNELS" || platform === "视频号";
}

function createPublishVideoHandler(context, dependencies) {
  dependencies = dependencies || {};
  var logger = context.logger;
  var uploader = context.uploader;
  var steps = dependencies.steps || null;
  var channelsHandler = dependencies.channelsHandler || null;
  var materialManager = dependencies.materialManager || loadBizModule(context, "domain/material-dir-manager.js")
    .createPublishMaterialManager({ logger: logger });
  var publishLock = dependencies.publishLock || loadBizModule(context, "domain/publish-task-lock.js")
    .createPublishTaskLock({ logger: logger });
  var executionWatchdog = dependencies.executionWatchdog ||
    loadBizModule(context, "domain/publish-watchdog.js").createPublishExecutorWatchdog({ timeoutMs: 10 * 60 * 1000 });
  var activeMaterialDir = "";
  var materialDownloader = dependencies.materialDownloader || {
    download: function (payload) {
      var timeoutMs = Math.max(1000, Number(payload.materialDownloadTimeoutMs || 20000));
      logger.info("发布素材下载开始", {
        taskId: payload.taskId || "",
        videoUrl: payload.videoUrl || "",
        coverUrl: payload.coverUrl || "",
        timeoutMs: timeoutMs
      });
      var paths = materialManager.beginTask(payload, context.config);
      activeMaterialDir = paths.dir;
      var downloaded = materialManager.download(paths, payload);
      logger.info("发布素材下载完成", {
        taskId: payload.taskId || "",
        videoBytes: Number(downloaded.videoBytes || 0),
        coverBytes: Number(downloaded.coverBytes || 0),
        totalBytes: Number(downloaded.totalBytes || 0)
      });
      return downloaded;
    }
  };
  var resultReporter = dependencies.resultReporter || createResultReporter(context.config);
  var taskFinalizer = dependencies.taskFinalizer || loadBizModule(context, "domain/publish-task-finalizer.js")
    .createPublishTaskFinalizer({
      logger: logger,
      resultReporter: resultReporter,
      uploader: uploader,
      device: context.config.device
    });
  var fixedWaitModule = dependencies.fixedWaitFlow ? null : loadBizModule(context, "features/publish-video/open-douyin-camera.js");
  var fixedWaitFlow = dependencies.fixedWaitFlow || (fixedWaitModule && fixedWaitModule.createFixedWaitPublishFlow &&
    fixedWaitModule.createFixedWaitPublishFlow({
      logger: logger,
      materialDomain: dependencies.materialDomain || loadBizModule(context, "domain/material-inspector.js"),
      wait: dependencies.mvpWait || function (ms) {
        if (context.sleep) return context.sleep(ms);
        if (typeof sleep === "function") return sleep(ms);
        throw new Error("MVP固定等待不可用");
      }
    }));

  var postPublishCleanupModule = dependencies.postPublishCleanup ? null : loadBizModule(
    context,
    "features/publish-video/douyin-post-publish-cleanup.js"
  );
  var postPublishCleanup = dependencies.postPublishCleanup || (
    postPublishCleanupModule &&
    postPublishCleanupModule.createDouyinPostPublishCleanup &&
    postPublishCleanupModule.createDouyinPostPublishCleanup({
      logger: logger,
      wait: dependencies.postPublishCleanupWait,
      openRecents: dependencies.openRecents,
      findDouyinCard: dependencies.findDouyinRecentsCard,
      dismissCard: dependencies.dismissDouyinRecentsCard,
      isPublishing: dependencies.isDouyinPublishInProgress || function () {
        var activeUi = douyinSteps().ui;
        return !!(activeUi && activeUi.isPublishInProgress && activeUi.isPublishInProgress());
      },
      cooldownMs: dependencies.postPublishCleanupCooldownMs
    })
  );

  function finishSuccessfulPublish(command, payload, publishResult, executionGuard, releaseResources) {
    var terminalResult = null;
    function finalizeBeforeReturn() {
      if (!terminalResult) {
        terminalResult = finish(command, payload, "SUCCEEDED", "", publishResult, executionGuard, releaseResources);
      }
      return terminalResult;
    }
    if (!postPublishCleanup || !postPublishCleanup.run) return finalizeBeforeReturn();
    try {
      var result = postPublishCleanup.run(payload, { beforeReturnToAgent: finalizeBeforeReturn });
      if (!result || !result.completed) {
        logger.warn("抖音发布成功后后台清理未完成", {
          taskId: payload.taskId || "",
          reason: result && result.reason || "UNKNOWN"
        });
      }
    } catch (error) {
      logger.warn("抖音发布成功后后台清理异常", {
        taskId: payload.taskId || "",
        message: String(error && error.message || error)
      });
    }
    return finalizeBeforeReturn();
  }
  function fixedWaitMvpRequested(payload) {
    var publishConfig = context.config && (context.config.publish || context.config) || {};
    return payload.publishFlowMode === "fixed_wait_mvp" || payload.useFixedWaitPublishFlow === true ||
      publishConfig.publishFlowMode === "fixed_wait_mvp" || publishConfig.useFixedWaitPublishFlow === true;
  }

  function douyinSteps() {
    if (!steps) steps = createDefaultSteps(context, dependencies.ui);
    return steps;
  }

  function wechatChannelsHandler() {
    if (!channelsHandler) {
      channelsHandler = loadBizModule(context, "features/publish-video/channels-publish-flow.js")
        .createWechatChannelsPublishHandler(context, {
          ui: dependencies.channelsUi,
          gate: dependencies.channelsGate,
          materialDownloader: materialDownloader,
          resultReporter: resultReporter,
        });
    }
    return channelsHandler;
  }

  function gateFor(payload) {
    if (dependencies.gate) return dependencies.gate;
    return loadBizModule(context, "domain/action-timing-gates.js").createActionTimeGate({
      responseDelayMsMin: payload.responseDelayMsMin,
      responseDelayMsMax: payload.responseDelayMsMax,
      actionWaitMsMin: payload.actionWaitMsMin,
      actionWaitMsMax: payload.actionWaitMsMax,
      targetStateTimeoutMs: 45000,
      pollIntervalMs: 500
    });
  }

  function waitForGate(gate, taskId, actionName, predicate) {
    logger.info("发布动作闸口开始", { taskId: taskId, action: actionName });
    var result = gate.waitForNext(actionName, predicate);
    logger.info("发布动作闸口完成", {
      taskId: taskId,
      action: actionName,
      responseDelayMs: Number(result && result.responseDelayMs || 0),
      actionWaitMs: Number(result && result.actionWaitMs || 0)
    });
    return result;
  }

  function finish(command, payload, status, errorMessage, publishResult, executionGuard, releaseResources) {
    logger.info("发布执行器结束", {
      commandId: command.id || "",
      taskId: payload.taskId || "",
      status: status,
      error: errorMessage || ""
    });
    if (executionGuard && executionGuard.timedOut()) {
      if (releaseResources) releaseResources();
      return { status: "FAILED", error: "执行器看门狗超时", watchdogTimedOut: true };
    }
    return taskFinalizer.finalize({
      command: command,
      payload: payload,
      status: status,
      errorMessage: errorMessage,
      publishResult: publishResult,
      releaseResources: releaseResources
    });
  }

  function fillDescription(activeSteps, payload, materials) {
    return activeSteps.fill(payload, materials);
  }

  function handle(command) {
    if (!command || command.commandType !== "PUBLISH_VIDEO_TASK") return { handled: false };
    var payload = command.payload || command.payloadJson || {};
    logger.info("REMOTE_BIZ_UPDATE_PROBE_V1", { taskId: payload.taskId || "" });
    logger.info("发布执行器启动", { commandId: command.id || "", taskId: payload.taskId || "" });
    var resourcesReleased = false;
    var lockAcquired = false;
    var executionGuard = executionWatchdog.start(function () {
      logger.error("发布执行器看门狗超时", { commandId: command.id || "", taskId: payload.taskId || "" });
      if (context.commandControl) context.commandControl.polling = false;
      try {
        uploader.ackCommand(command.id, "FAILED", {
          applied: false,
          commandType: "PUBLISH_VIDEO_TASK",
          status: "FAILED",
          message: "执行器看门狗超时"
        });
      } catch (error) {
        logger.error("发布执行器看门狗ACK失败", { commandId: command.id || "", message: String(error) });
      }
    });
    function releaseResources() {
      if (resourcesReleased) return;
      resourcesReleased = true;
      try {
        if (lockAcquired && activeMaterialDir) materialManager.endTask(activeMaterialDir);
      } finally {
        if (lockAcquired) {
          activeMaterialDir = "";
          publishLock.release();
          lockAcquired = false;
        }
        executionGuard.complete();
      }
    }
    if (!publishLock.acquire({ taskId: payload.taskId || "", commandId: command.id || "" })) {
      try {
        return finish(command, payload, "PUBLISH_BUSY", "上一发布任务仍在执行", null, executionGuard, releaseResources);
      } finally {
        releaseResources();
      }
    }
    lockAcquired = true;
    activeMaterialDir = "";
    try {
      if (!payload.taskId) return finish(command, payload, "MATERIAL_INVALID", "taskId不能为空", null, executionGuard, releaseResources);
      if (isWechatChannelsTask(payload)) return wechatChannelsHandler().handle(command);
      var materials;
      try {
        materials = materialDownloader.download(payload);
      } catch (downloadError) {
        var downloadReason = String(downloadError && downloadError.message || downloadError || "素材下载失败");
        return finish(command, payload, "MATERIAL_INVALID", downloadReason, null, executionGuard, releaseResources);
      }

      try {
        var activeSteps = douyinSteps();
        if (fixedWaitMvpRequested(payload)) {
          if (!fixedWaitFlow) throw new Error("fixed_wait_mvp 发布流程未预加载");
          var mvpResult = fixedWaitFlow.run(activeSteps, payload, materials, function () {
            return fillDescription(activeSteps, payload, materials);
          });
          logger.info("抖音发布任务执行成功", { taskId: payload.taskId, mode: "fixed_wait_mvp" });
          return finishSuccessfulPublish(command, payload, mvpResult, executionGuard, releaseResources);
        }
        var gate = gateFor(payload);
        logger.info("发布前准备打开App", { taskId: payload.taskId, platform: "DOUYIN" });
        activeSteps.open(payload);
        waitForGate(gate, payload.taskId, "选择发布素材", activeSteps.states.galleryReady);
        activeSteps.select(materials, payload);
        waitForGate(gate, payload.taskId, "编辑封面", activeSteps.states.coverEditReady);
        activeSteps.editCover(materials, payload);
        waitForGate(gate, payload.taskId, "填写标题描述话题", activeSteps.states.publishFormReady);
        fillDescription(activeSteps, payload, materials);
        waitForGate(gate, payload.taskId, "执行发布与结果判定", activeSteps.states.publishReviewReady);
        var publishResult = activeSteps.publish(payload, materials) || {};
        logger.info("抖音发布任务执行成功", { taskId: payload.taskId });
        return finishSuccessfulPublish(command, payload, publishResult, executionGuard, releaseResources);
      } catch (error) {
        var status = error && error.publishStatus || "FAILED";
        var reason = String(error && error.message || error || "发布步骤失败");
        logger.warn("抖音发布任务执行失败", { taskId: payload.taskId, status: status, reason: reason });
        return finish(command, payload, status, reason, null, executionGuard, releaseResources);
      }
    } finally {
      releaseResources();
    }
  }

  return { handle: handle };
}

module.exports = {
  createPublishVideoHandler: createPublishVideoHandler,
  createResultReporter: createResultReporter,
  isWechatChannelsTask: isWechatChannelsTask
};
