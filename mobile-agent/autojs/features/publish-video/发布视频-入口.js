function joinPath() {
  return Array.prototype.slice.call(arguments).filter(Boolean).join("/").replace(/\/+/g, "/");
}

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

function signedHeaders(config, url, bodyText) {
  var timestamp = new Date().toISOString();
  var bodyHash = sha256Hex(bodyText);
  var uri = android.net.Uri.parse(url);
  var canonical = [
    "POST",
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

function ensureDir(path) {
  if (!files.exists(path)) {
    files.createWithDirs(joinPath(path, ".keep"));
    files.remove(joinPath(path, ".keep"));
  }
}

function safeName(value) {
  return String(value || "publish-video").replace(/[^0-9A-Za-z_-]+/g, "_");
}

function urlExtension(url, fallback, allowed) {
  var match = /\.([0-9A-Za-z]{2,5})(?:[?#]|$)/.exec(String(url || ""));
  var value = match ? "." + match[1].toLowerCase() : fallback;
  return allowed.indexOf(value) >= 0 ? value : fallback;
}

function scanMedia(path) {
  try {
    if (typeof media !== "undefined" && media && media.scanFile) media.scanFile(path);
  } catch (error) {}
}

function createMaterialDownloader(config) {
  function downloadOne(url, path, label) {
    var response = http.get(url, {
      timeout: Math.max(15000, Number(config.upload.timeoutMs || 5000) * 4)
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(label + "下载失败：HTTP " + response.statusCode);
    }
    var bytes = response.body.bytes();
    if (!bytes || !bytes.length) throw new Error(label + "下载失败：文件为空");
    files.writeBytes(path, bytes);
    scanMedia(path);
    return path;
  }

  return {
    download: function (payload) {
      if (!payload.videoUrl) throw new Error("videoUrl不能为空");
      var fallbackRoot = config.output && (config.output.cacheDir || config.output.baseDir) || "/sdcard/Download";
      var downloadDir = String(payload.downloadDir || joinPath(fallbackRoot, "publish-video"));
      ensureDir(downloadDir);
      var taskName = safeName(payload.taskId);
      var videoPath = joinPath(downloadDir, taskName + "-video" + urlExtension(
        payload.videoUrl,
        ".mp4",
        [".mp4", ".mov", ".m4v"]
      ));
      var coverPath = payload.coverUrl ? joinPath(downloadDir, taskName + "-cover" + urlExtension(
        payload.coverUrl,
        ".jpg",
        [".jpg", ".jpeg", ".png", ".webp"]
      )) : "";
      downloadOne(payload.videoUrl, videoPath, "视频素材");
      if (payload.coverUrl) downloadOne(payload.coverUrl, coverPath, "封面素材");
      return { downloadDir: downloadDir, videoPath: videoPath, coverPath: coverPath };
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
  var materialDownloader = dependencies.materialDownloader || createMaterialDownloader(context.config);
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
          resultReporter: resultReporter
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

  function finish(command, payload, status, errorMessage, publishResult) {
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

  function handle(command) {
    if (!command || command.commandType !== "PUBLISH_VIDEO_TASK") return { handled: false };
    var payload = command.payload || command.payloadJson || {};
    if (isWechatChannelsTask(payload)) return wechatChannelsHandler().handle(command);
    if (!payload.taskId) return finish(command, payload, "MATERIAL_INVALID", "taskId不能为空", null);
    var materials;
    try {
      materials = materialDownloader.download(payload);
    } catch (downloadError) {
      return finish(command, payload, "MATERIAL_INVALID", String(downloadError), null);
    }

    try {
      var gate = gateFor(payload);
      var activeSteps = douyinSteps();
      activeSteps.open(payload);
      gate.waitForNext("选择发布素材", activeSteps.states.galleryReady);
      activeSteps.select(materials, payload);
      gate.waitForNext("编辑封面", activeSteps.states.coverEditReady);
      activeSteps.editCover(materials, payload);
      gate.waitForNext("填写标题描述话题", activeSteps.states.publishFormReady);
      activeSteps.fill(payload, materials);
      gate.waitForNext("执行发布与结果判定", activeSteps.states.publishReviewReady);
      var publishResult = activeSteps.publish(payload, materials) || {};
      logger.info("抖音发布任务执行成功", { taskId: payload.taskId });
      return finish(command, payload, "SUCCEEDED", "", publishResult);
    } catch (error) {
      var status = error && error.publishStatus || "FAILED";
      var reason = String(error && error.message || error || "发布步骤失败");
      logger.warn("抖音发布任务执行失败", { taskId: payload.taskId, status: status, reason: reason });
      return finish(command, payload, status, reason, null);
    }
  }

  return { handle: handle };
}

module.exports = {
  createMaterialDownloader: createMaterialDownloader,
  createPublishVideoHandler: createPublishVideoHandler,
  createResultReporter: createResultReporter,
  isWechatChannelsTask: isWechatChannelsTask
};
