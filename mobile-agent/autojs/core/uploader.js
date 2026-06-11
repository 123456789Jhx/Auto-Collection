function createUploader(config, logger, storage) {
  function endpoint(path) {
    var baseUrl = config.upload.baseUrl || "";
    return baseUrl.replace(/\/$/, "") + path;
  }

  function requestHeaders() {
    var headers = {
      "X-Device-Id": config.device.deviceId || ""
    };
    if (config.device.deviceToken) {
      headers["X-Device-Token"] = config.device.deviceToken;
    }
    return headers;
  }

  var requestStartLogAt = {};

  function shouldLogRequestStart(key) {
    var now = Date.now();
    var intervalMs = Number(config.upload.requestStartLogIntervalMs || 5 * 60 * 1000);
    var lastAt = requestStartLogAt[key] || 0;
    if (!lastAt || now - lastAt >= intervalMs) {
      requestStartLogAt[key] = now;
      return true;
    }
    return false;
  }

  function randomHex(length) {
    var chars = "0123456789abcdef";
    var value = "";
    for (var i = 0; i < length; i++) {
      value += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return value;
  }

  function ensureDeviceToken() {
    if (config.device.deviceToken) {
      return config.device.deviceToken;
    }
    try {
      var store = storages.create("AgriVideoCollectorDevice");
      var token = store.get("deviceToken", "");
      if (!token) {
        token = randomHex(64);
        store.put("deviceToken", token);
      }
      config.device.deviceToken = token;
      return token;
    } catch (error) {
      var fallbackToken = randomHex(64);
      config.device.deviceToken = fallbackToken;
      logger.warn("设备 token 本地持久化失败，使用临时 token", { message: String(error) });
      return fallbackToken;
    }
  }

  function registerDeviceToken() {
    if (!config.upload.enabled) {
      return { enabled: false, success: false, message: "upload disabled" };
    }
    var token = ensureDeviceToken();
    try {
      var response = postJson(endpoint("/mobile/device-token/register"), {
        deviceId: config.device.deviceId,
        platform: config.task.platform,
        appVersion: config.app.version,
        deviceToken: token,
        deviceInfo: {
          brand: device.brand,
          model: device.model,
          sdkInt: device.sdkInt,
          width: device.width,
          height: device.height
        },
        reportedAt: new Date().toISOString()
      });
      var body = response.body ? response.body.string() : "";
      logger.info("设备 token 注册完成", {
        statusCode: response.statusCode,
        body: body
      });
      return {
        enabled: true,
        success: response.statusCode >= 200 && response.statusCode < 300,
        statusCode: response.statusCode,
        body: body
      };
    } catch (error) {
      logger.warn("设备 token 注册失败", { message: String(error) });
      return {
        enabled: true,
        success: false,
        message: String(error)
      };
    }
  }

  function postJson(url, payload) {
    return http.postJson(url, payload, {
      timeout: config.upload.timeoutMs,
      headers: requestHeaders()
    });
  }

  function getJson(url) {
    return http.get(url, {
      timeout: config.upload.timeoutMs,
      headers: requestHeaders()
    });
  }

  function upload(candidate) {
    if (!config.upload.enabled) {
      return {
        enabled: false,
        success: false,
        message: "upload disabled"
      };
    }

    try {
      var payload = {
        taskId: config.task.taskId,
        deviceId: config.device.deviceId,
        platform: candidate.platform || config.task.platform,
        sceneType: candidate.sceneType || "video",
        keyword: candidate.keyword || "",
        matchedKeywords: candidate.match && candidate.match.agricultureHits ? candidate.match.agricultureHits : [],
        authorName: candidate.authorName || "",
        titleText: candidate.titleText || "",
        subtitleText: candidate.subtitleText || "",
        metricsText: candidate.metricsText || "",
        hotComments: candidate.hotComments || [],
        screenText: candidate.screenText || "",
        rawPayload: candidate,
        capturedAt: candidate.capturedAt || new Date().toISOString()
      };
      var response = postJson(config.upload.url, payload);
      var statusCode = response.statusCode;
      var body = response.body ? response.body.string() : "";
      var success = statusCode >= 200 && statusCode < 300;
      logger.info("候选记录上传完成", {
        success: success,
        statusCode: statusCode,
        body: body
      });
      return {
        enabled: true,
        success: success,
        statusCode: statusCode,
        body: body
      };
    } catch (error) {
      logger.warn("候选记录上传失败", { message: String(error) });
      return {
        enabled: true,
        success: false,
        message: String(error)
      };
    }
  }

  function uploadHeartbeat(payload) {
    if (!config.upload.enabled) {
      return { enabled: false, success: false, message: "upload disabled" };
    }

    try {
      var body = {
        taskId: config.task.taskId,
        deviceId: config.device.deviceId,
        appVersion: config.app.version,
        status: payload.status || "running",
        sceneType: payload.sceneType,
        elapsedMinutes: payload.elapsedMinutes,
        remainingMinutes: payload.remainingMinutes,
        viewedCount: payload.viewedCount,
        liveViewedCount: payload.liveViewedCount,
        liveRoomEnteredCount: payload.liveRoomEnteredCount,
        liveCandidateCount: payload.liveCandidateCount,
        liveRejectedCount: payload.liveRejectedCount,
        capturedCount: payload.capturedCount,
        lastMessage: payload.lastMessage,
        expectedEndAt: payload.expectedEndAt,
        rawPayload: payload,
        reportedAt: payload.reportedAt || new Date().toISOString()
      };
      var response = postJson(endpoint("/mobile/heartbeats"), body);
      var statusCode = response.statusCode;
      var responseBody = response.body ? response.body.string() : "";
      var success = statusCode >= 200 && statusCode < 300;
      if (!success) {
        logger.warn("heartbeat upload failed", {
          statusCode: statusCode,
          body: responseBody
        });
      }
      return {
        enabled: true,
        success: success,
        statusCode: statusCode,
        body: responseBody
      };
    } catch (error) {
      logger.warn("心跳上传失败", { message: String(error) });
      return {
        enabled: true,
        success: false,
        message: String(error)
      };
    }
  }

  function uploadRuntimeLog(level, message, context) {
    if (!config.upload.enabled) {
      return { enabled: false, success: false, message: "upload disabled" };
    }

    try {
      var payload = {
        taskId: config.task.taskId,
        deviceId: config.device.deviceId,
        level: level,
        message: message,
        context: context || {},
        stopReason: context && context.stopReason ? context.stopReason : undefined,
        reportedAt: new Date().toISOString()
      };
      var response = postJson(endpoint("/mobile/runtime-logs"), payload);
      return {
        enabled: true,
        success: response.statusCode >= 200 && response.statusCode < 300,
        statusCode: response.statusCode
      };
    } catch (error) {
      logger.warn("运行日志上传失败", { level: level, message: message, error: String(error) });
      return {
        enabled: true,
        success: false,
        message: String(error)
      };
    }
  }

  function dateFromFileName(filePath) {
    var name = files.getName(filePath || "");
    var match = /^(\d{4}-\d{2}-\d{2})/.exec(name);
    if (match) {
      return match[1];
    }
    return new Date().toISOString().slice(0, 10);
  }

  function pad(value) {
    return value < 10 ? "0" + value : "" + value;
  }

  function dateString(date) {
    return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
  }

  function dateBefore(days) {
    var date = new Date();
    date.setDate(date.getDate() - Math.max(0, Number(days || 0)));
    return dateString(date);
  }

  function uploadLogFile(filePath) {
    if (!config.upload.enabled) {
      return { enabled: false, success: false, message: "upload disabled" };
    }
    if (!filePath || !files.exists(filePath)) {
      return { enabled: true, success: false, message: "log file not found" };
    }

    try {
      var content = files.read(filePath);
      var maxBytes = Number(config.upload.maxLogUploadBytes || 2 * 1024 * 1024);
      if (maxBytes > 0 && content.length > maxBytes) {
        content = content.slice(content.length - maxBytes);
      }
      var payload = {
        taskId: config.task.taskId,
        deviceId: config.device.deviceId,
        logDate: dateFromFileName(filePath),
        fileName: files.getName(filePath),
        content: content,
        fileSizeBytes: content.length,
        uploadedAt: new Date().toISOString()
      };
      var response = postJson(endpoint("/mobile/log-files"), payload);
      var success = response.statusCode >= 200 && response.statusCode < 300;
      logger.info("完整日志上传完成", {
        success: success,
        statusCode: response.statusCode,
        fileName: payload.fileName,
        fileSizeBytes: payload.fileSizeBytes
      });
      return {
        enabled: true,
        success: success,
        statusCode: response.statusCode
      };
    } catch (error) {
      logger.warn("完整日志上传失败", { filePath: filePath, message: String(error) });
      return {
        enabled: true,
        success: false,
        message: String(error)
      };
    }
  }

  function isDailyLogFile(filePath) {
    var name = files.getName(filePath || "");
    return /^\d{4}-\d{2}-\d{2}\.log(\.1)?$/.test(name);
  }

  function listLogFiles(options) {
    var result = [];
    try {
      var dir = config.output.logDir;
      if (!dir || !files.exists(dir)) {
        return result;
      }
      options = options || {};
      var fromDate = options.fromDate || "";
      var toDate = options.toDate || "";
      var exactDate = options.logDate || "";
      var names = files.listDir(dir) || [];
      var paths = names.map(function (name) {
        return files.join(dir, name);
      }).filter(function (filePath) {
        try {
          if (!new java.io.File(filePath).isFile() || !isDailyLogFile(filePath)) {
            return false;
          }
          var logDate = dateFromFileName(filePath);
          if (exactDate && logDate !== exactDate) {
            return false;
          }
          if (fromDate && logDate < fromDate) {
            return false;
          }
          if (toDate && logDate > toDate) {
            return false;
          }
          return true;
        } catch (error) {
          return false;
        }
      });
      paths.sort(function (a, b) {
        try {
          return new java.io.File(b).lastModified() - new java.io.File(a).lastModified();
        } catch (error) {
          return files.getName(b) > files.getName(a) ? 1 : -1;
        }
      });
      if (options.limit) {
        result = paths.slice(0, Math.max(1, Number(options.limit)));
      } else {
        result = paths;
      }
    } catch (error2) {
      logger.warn("扫描运行日志目录失败", { message: String(error2) });
    }
    return result;
  }

  function listRecentLogFiles(limit) {
    return listLogFiles({ limit: limit || config.upload.logUploadRecentDays || 7 });
  }

  function normalizeLogUploadOptions(options) {
    options = options || {};
    var limit = Math.max(1, Number(options.limit || options.days || config.upload.logUploadRecentDays || 7));
    if (options.logDate) {
      return { logDate: String(options.logDate), limit: limit };
    }
    if (options.fromDate || options.toDate) {
      return {
        fromDate: options.fromDate ? String(options.fromDate) : "",
        toDate: options.toDate ? String(options.toDate) : "",
        limit: limit
      };
    }
    if (options.days) {
      return { fromDate: dateBefore(Number(options.days) - 1), limit: limit };
    }
    return { limit: limit };
  }

  function uploadRecentLogFiles(limit) {
    var logFiles = listRecentLogFiles(limit);
    return uploadLogFiles(logFiles);
  }

  function uploadLogFilesByOptions(options) {
    var normalized = normalizeLogUploadOptions(options);
    return uploadLogFiles(listLogFiles(normalized));
  }

  function uploadLogFiles(logFiles) {
    if (!logFiles.length) {
      return { enabled: true, success: false, message: "no log files found", uploadedCount: 0 };
    }
    var uploadedCount = 0;
    var failedCount = 0;
    var lastResult = null;
    for (var i = 0; i < logFiles.length; i++) {
      lastResult = uploadLogFile(logFiles[i]);
      if (lastResult && lastResult.success) {
        uploadedCount += 1;
      } else {
        failedCount += 1;
      }
    }
    return {
      enabled: true,
      success: uploadedCount > 0 && failedCount === 0,
      uploadedCount: uploadedCount,
      failedCount: failedCount,
      message: failedCount ? "some log files failed" : "log files uploaded",
      statusCode: lastResult && lastResult.statusCode
    };
  }

  function retryCached() {
    if (!config.upload.enabled || !config.upload.retryCachedOnStart) {
      return;
    }

    var filesToUpload = storage.listCachedCandidates();
    filesToUpload.forEach(function (filePath) {
      try {
        var candidate = storage.readJson(filePath);
        var result = upload(candidate);
        if (result.success) {
          storage.markUploaded(filePath);
          logger.info("缓存候选记录补传成功", { filePath: filePath });
        }
      } catch (error) {
        logger.warn("缓存候选记录补传失败", {
          filePath: filePath,
          message: String(error)
        });
      }
    });
  }

  function pollCommands(deviceId) {
    if (!config.upload.controlEnabled) {
      return [];
    }

    try {
      var url = endpoint("/mobile/commands?deviceId=" + encodeURIComponent(deviceId));
      if (shouldLogRequestStart("pollCommands")) {
        logger.info("后台控制指令拉取开始", { url: url, deviceId: deviceId });
      }
      var response = getJson(url);
      var statusCode = response.statusCode;
      var body = response.body ? response.body.string() : "";
      if (statusCode < 200 || statusCode >= 300) {
        logger.warn("后台控制指令拉取失败", { statusCode: statusCode, body: body });
        return [];
      }
      var payload = JSON.parse(body || "{}");
      var commands = payload.data || [];
      if (commands.length > 0 || shouldLogRequestStart("pollCommandsEmpty")) {
        logger.info("后台控制指令拉取完成", {
          statusCode: statusCode,
          commandCount: commands.length
        });
      }
      return commands;
    } catch (error) {
      logger.warn("后台控制指令拉取异常", {
        baseUrl: config.upload.baseUrl,
        message: String(error)
      });
      return [];
    }
  }

  function ackCommand(commandId, status, result) {
    if (!config.upload.controlEnabled) {
      return;
    }

    try {
      var response = postJson(endpoint("/mobile/commands/" + commandId + "/ack"), {
        deviceId: config.device.deviceId,
        status: status,
        result: result || {}
      });
      logger.info("后台控制指令回执完成", {
        commandId: commandId,
        commandStatus: status,
        statusCode: response.statusCode
      });
    } catch (error) {
      logger.warn("后台控制指令回执失败", {
        commandId: commandId,
        commandStatus: status,
        message: String(error)
      });
    }
  }

  function fetchCurrentTask() {
    if (!config.upload.enabled) {
      return null;
    }

    try {
      var url =
        endpoint("/mobile/tasks/current") +
        "?deviceId=" +
        encodeURIComponent(config.device.deviceId) +
        "&platform=" +
        encodeURIComponent(config.task.platform || "douyin");
      if (shouldLogRequestStart("fetchCurrentTask")) {
        logger.info("拉取当前任务配置开始", { url: url });
      }
      var response = getJson(url);
      var statusCode = response.statusCode;
      var body = response.body ? response.body.string() : "";
      if (statusCode < 200 || statusCode >= 300) {
        logger.warn("拉取当前任务配置失败", { statusCode: statusCode, body: body });
        return null;
      }
      var payload = JSON.parse(body || "{}");
      logger.info("拉取当前任务配置完成", {
        taskId: payload.taskId,
        configSource: payload.configSource,
        videoMinutesMin: payload.videoMinutesMin,
        videoMinutesMax: payload.videoMinutesMax,
        liveMinutesMin: payload.liveMinutesMin,
        liveMinutesMax: payload.liveMinutesMax
      });
      return payload;
    } catch (error) {
      logger.warn("拉取当前任务配置异常", { message: String(error) });
      return null;
    }
  }

  function checkAgentVersion() {
    if (!config.upload.enabled || !config.upload.versionCheckEnabled) {
      return null;
    }

    try {
      var url =
        endpoint("/mobile/agent-version") +
        "?deviceId=" +
        encodeURIComponent(config.device.deviceId) +
        "&currentVersion=" +
        encodeURIComponent(config.app.version) +
        "&channel=" +
        encodeURIComponent(config.upload.versionChannel || "stable");
      if (shouldLogRequestStart("checkAgentVersion")) {
        logger.info("手机 Agent 版本检查开始", { url: url, currentVersion: config.app.version });
      }
      var response = getJson(url);
      var statusCode = response.statusCode;
      var body = response.body ? response.body.string() : "";
      if (statusCode < 200 || statusCode >= 300) {
        logger.warn("手机 Agent 版本检查失败", { statusCode: statusCode, body: body });
        return null;
      }
      var payload = JSON.parse(body || "{}");
      logger.info("手机 Agent 版本检查完成", payload);
      return payload;
    } catch (error) {
      logger.warn("手机 Agent 版本检查异常", { message: String(error) });
      return null;
    }
  }

  function uploadAgentUpdateEvent(event) {
    if (!config.upload.enabled) {
      return { enabled: false, success: false, message: "upload disabled" };
    }

    try {
      var payload = {
        deviceId: config.device.deviceId,
        fromVersion: event.fromVersion || config.app.version,
        toVersion: event.toVersion,
        eventType: event.eventType,
        message: event.message,
        payload: event.payload || {},
        reportedAt: event.reportedAt || new Date().toISOString()
      };
      var response = postJson(endpoint("/mobile/agent-update-events"), payload);
      return {
        enabled: true,
        success: response.statusCode >= 200 && response.statusCode < 300,
        statusCode: response.statusCode
      };
    } catch (error) {
      logger.warn("手机 Agent 更新事件上报失败", { eventType: event.eventType, message: String(error) });
      return {
        enabled: true,
        success: false,
        message: String(error)
      };
    }
  }

  return {
    upload: upload,
    uploadHeartbeat: uploadHeartbeat,
    uploadRuntimeLog: uploadRuntimeLog,
    uploadLogFile: uploadLogFile,
    uploadRecentLogFiles: uploadRecentLogFiles,
    uploadLogFilesByOptions: uploadLogFilesByOptions,
    ensureDeviceToken: ensureDeviceToken,
    registerDeviceToken: registerDeviceToken,
    retryCached: retryCached,
    pollCommands: pollCommands,
    ackCommand: ackCommand,
    fetchCurrentTask: fetchCurrentTask,
    checkAgentVersion: checkAgentVersion,
    uploadAgentUpdateEvent: uploadAgentUpdateEvent
  };
}

module.exports = {
  createUploader: createUploader
};
