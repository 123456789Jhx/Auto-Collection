function loadBizModule(context, path) {
  if (context.loadBizScript) return context.loadBizScript(path);
  return require(files.join(context.config.runtime.scriptDir, path));
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

function createTopicQuery(config) {
  return function queryTopic(taskId) {
    var baseUrl = String(config.upload.baseUrl || "").replace(/\/$/, "");
    var deviceId = config.device.deviceId || "";
    var url = baseUrl + "/mobile/publish-tasks/" + encodeURIComponent(taskId) +
      "/topics?deviceId=" + encodeURIComponent(deviceId);
    var response = http.get(url, {
      timeout: config.upload.timeoutMs,
      headers: signedHeaders(config, url, "", "GET")
    });
    var responseBody = response.body ? response.body.string() : "";
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error("话题补全查询失败：" + response.statusCode + " " + responseBody.slice(0, 160));
    }
    return JSON.parse(responseBody || "{}");
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
  var ui = injectedUi || loadBizModule(context, "features/publish-video/抖音发布界面.js")
    .createDouyinPublishUi(context);
  var materialDomain = loadBizModule(context, "domain/素材判断.js");
  var topicDomain = loadBizModule(context, "domain/话题校验.js");
  return {
    open: loadBizModule(context, "features/publish-video/打开抖音到相机页.js")
      .createOpenDouyinCameraStep(ui),
    select: loadBizModule(context, "features/publish-video/选择发布素材.js")
      .createSelectPublishMaterialStep(ui, materialDomain.chooseVideoMaterial),
    editCover: loadBizModule(context, "features/publish-video/编辑封面.js")
      .createEditCoverStep(ui),
    fill: loadBizModule(context, "features/publish-video/填写标题描述话题.js")
      .createFillPublishTextStep(ui, topicDomain),
    publish: loadBizModule(context, "features/publish-video/执行发布与结果判定.js")
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
  var materialManager = dependencies.materialManager || loadBizModule(context, "domain/素材目录管理.js")
    .createPublishMaterialManager({ logger: logger });
  var publishLock = dependencies.publishLock || loadBizModule(context, "domain/发布任务锁.js")
    .createPublishTaskLock();
  var executionWatchdog = dependencies.executionWatchdog ||
    loadBizModule(context, "domain/发布执行器看门狗.js").createPublishExecutorWatchdog({ timeoutMs: 10 * 60 * 1000 });
  var topicDomain = dependencies.topicDomain || loadBizModule(context, "domain/话题校验.js");
  var topicContinuation = dependencies.topicContinuation || loadBizModule(context, "domain/话题断点续传.js")
    .createTopicContinuation({
      fetchTopic: createTopicQuery(context.config),
      validateDescriptionTopics: topicDomain.validateDescriptionTopics
    });
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

  function douyinSteps() {
    if (!steps) steps = createDefaultSteps(context, dependencies.ui);
    return steps;
  }

  function wechatChannelsHandler() {
    if (!channelsHandler) {
      channelsHandler = loadBizModule(context, "features/publish-video/视频号发布全流程.js")
        .createWechatChannelsPublishHandler(context, {
          ui: dependencies.channelsUi,
          gate: dependencies.channelsGate,
          materialDownloader: materialDownloader,
          resultReporter: resultReporter,
          topicContinuation: topicContinuation
        });
    }
    return channelsHandler;
  }

  function gateFor(payload) {
    if (dependencies.gate) return dependencies.gate;
    return loadBizModule(context, "domain/动作时间闸口.js").createActionTimeGate({
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

  function finish(command, payload, status, errorMessage, publishResult, executionGuard) {
    logger.info("发布执行器结束", {
      commandId: command.id || "",
      taskId: payload.taskId || "",
      status: status,
      error: errorMessage || ""
    });
    if (executionGuard && executionGuard.timedOut()) {
      return { status: "FAILED", error: "执行器看门狗超时", watchdogTimedOut: true };
    }
    var report = {
      deviceId: context.config.device.deviceId || "",
      deviceToken: context.config.device.deviceToken || "",
      status: status
    };
    if (errorMessage) report.error = errorMessage;
    if (publishResult && publishResult.publishedUrl) report.publishedUrl = publishResult.publishedUrl;
    if (publishResult && publishResult.platformContentId) report.platformContentId = publishResult.platformContentId;
    try {
      resultReporter.report(payload.taskId, report);
    } catch (reportError) {
      var reportFailure = "发布结果回传失败：" + String(reportError);
      logger.warn(reportFailure, { taskId: payload.taskId, status: status });
      uploader.ackCommand(command.id, "FAILED", {
        applied: false,
        commandType: "PUBLISH_VIDEO_TASK",
        status: status,
        message: reportFailure
      });
      return { status: status, error: errorMessage || "", reportFailed: true, reportError: reportFailure };
    }
    var ackStatus = status === "SUCCEEDED" || status === "TOPIC_PENDING" ? "DONE" : "FAILED";
    uploader.ackCommand(command.id, ackStatus, {
      applied: status === "SUCCEEDED",
      commandType: "PUBLISH_VIDEO_TASK",
      status: status,
      message: errorMessage || "",
      publishedUrl: report.publishedUrl || "",
      platformContentId: report.platformContentId || ""
    });
    return {
      status: status,
      error: errorMessage || "",
      publishedUrl: report.publishedUrl || "",
      platformContentId: report.platformContentId || ""
    };
  }

  function reportTopicPending(payload, reason) {
    resultReporter.report(payload.taskId, {
      deviceId: context.config.device.deviceId || "",
      deviceToken: context.config.device.deviceToken || "",
      status: "TOPIC_PENDING",
      error: reason || "话题待补充"
    });
  }

  function fillWithTopicContinuation(activeSteps, payload, materials) {
    try {
      return activeSteps.fill(payload, materials);
    } catch (error) {
      if (!error || error.publishStatus !== "TOPIC_PENDING") throw error;
      var reason = String(error.message || "话题待补充");
      reportTopicPending(payload, reason);
      payload.description = topicContinuation.waitForResolvedDescription(payload);
      return activeSteps.fill(payload, materials);
    }
  }

  function handle(command) {
    if (!command || command.commandType !== "PUBLISH_VIDEO_TASK") return { handled: false };
    var payload = command.payload || command.payloadJson || {};
    logger.info("发布执行器启动", { commandId: command.id || "", taskId: payload.taskId || "" });
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
    if (!publishLock.acquire()) {
      try {
        return finish(command, payload, "PUBLISH_BUSY", "上一发布任务仍在执行", null, executionGuard);
      } finally {
        executionGuard.complete();
      }
    }
    activeMaterialDir = "";
    try {
      if (!payload.taskId) return finish(command, payload, "MATERIAL_INVALID", "taskId不能为空", null, executionGuard);
      var topicValidation = topicDomain.validateDescriptionTopics(
        payload.description,
        payload.expectedTopicCount
      );
      if (!topicValidation.valid) {
        return finish(command, payload, "TOPIC_PENDING", topicValidation.reason, null, executionGuard);
      }
      if (isWechatChannelsTask(payload)) return wechatChannelsHandler().handle(command);
      var materials;
      try {
        materials = materialDownloader.download(payload);
      } catch (downloadError) {
        var downloadReason = String(downloadError && downloadError.message || downloadError || "素材下载失败");
        return finish(command, payload, "MATERIAL_INVALID", downloadReason, null, executionGuard);
      }

      try {
        var gate = gateFor(payload);
        var activeSteps = douyinSteps();
        logger.info("发布前准备打开App", { taskId: payload.taskId, platform: "DOUYIN" });
        activeSteps.open(payload);
        waitForGate(gate, payload.taskId, "选择发布素材", activeSteps.states.galleryReady);
        activeSteps.select(materials, payload);
        waitForGate(gate, payload.taskId, "编辑封面", activeSteps.states.coverEditReady);
        activeSteps.editCover(materials, payload);
        waitForGate(gate, payload.taskId, "填写标题描述话题", activeSteps.states.publishFormReady);
        fillWithTopicContinuation(activeSteps, payload, materials);
        waitForGate(gate, payload.taskId, "执行发布与结果判定", activeSteps.states.publishReviewReady);
        var publishResult = activeSteps.publish(payload, materials) || {};
        logger.info("抖音发布任务执行成功", { taskId: payload.taskId });
        return finish(command, payload, "SUCCEEDED", "", publishResult, executionGuard);
      } catch (error) {
        var status = error && error.publishStatus || "FAILED";
        var reason = String(error && error.message || error || "发布步骤失败");
        logger.warn("抖音发布任务执行失败", { taskId: payload.taskId, status: status, reason: reason });
        return finish(command, payload, status, reason, null, executionGuard);
      }
    } finally {
      try {
        if (activeMaterialDir) materialManager.endTask(activeMaterialDir);
      } finally {
        activeMaterialDir = "";
        publishLock.release();
        executionGuard.complete();
      }
    }
  }

  return { handle: handle };
}

module.exports = {
  createPublishVideoHandler: createPublishVideoHandler,
  createResultReporter: createResultReporter,
  isWechatChannelsTask: isWechatChannelsTask
};
