function createUploader(config, logger, storage) {
  function endpoint(path) {
    var baseUrl = config.upload.baseUrl || "";
    return baseUrl.replace(/\/$/, "") + path;
  }

  function bytesToHex(bytes) {
    var hex = "";
    for (var i = 0; i < bytes.length; i++) {
      var value = bytes[i];
      if (value < 0) {
        value += 256;
      }
      var part = value.toString(16);
      hex += part.length === 1 ? "0" + part : part;
    }
    return hex;
  }

  function sha256Hex(value) {
    var digest = java.security.MessageDigest.getInstance("SHA-256");
    digest.update(new java.lang.String(value || "").getBytes("UTF-8"));
    return bytesToHex(digest.digest());
  }

  function sha256FileHex(filePath) {
    var digest = java.security.MessageDigest.getInstance("SHA-256");
    var input = new java.io.FileInputStream(filePath);
    var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
    try {
      var readCount = input.read(buffer);
      while (readCount > 0) {
        digest.update(buffer, 0, readCount);
        readCount = input.read(buffer);
      }
    } finally {
      input.close();
    }
    return bytesToHex(digest.digest());
  }

  function hmacSha256Hex(secret, value) {
    var mac = javax.crypto.Mac.getInstance("HmacSHA256");
    var key = new javax.crypto.spec.SecretKeySpec(new java.lang.String(secret || "").getBytes("UTF-8"), "HmacSHA256");
    mac.init(key);
    return bytesToHex(mac.doFinal(new java.lang.String(value || "").getBytes("UTF-8")));
  }

  function canonicalRequest(url, method, timestamp, bodyHash) {
    var uri = android.net.Uri.parse(url);
    var query = uri.getEncodedQuery() || "";
    return [
      String(method || "GET").toUpperCase(),
      uri.getEncodedPath() || "/",
      query,
      timestamp,
      bodyHash
    ].join("\n");
  }

  function requestHeaders(url, method, bodyText, options) {
    options = options || {};
    ensureDeviceIdentity();
    var token = config.device.deviceToken || "";
    var timestamp = new Date().toISOString();
    var bodyHash = sha256Hex(bodyText || "");
    var headers = {
      "X-Device-Id": config.device.deviceId || "",
      "X-Timestamp": timestamp,
      "X-Body-SHA256": bodyHash
    };
    if (token) {
      if (options.includeDeviceToken) {
        headers["X-Device-Token"] = token;
      }
      headers["X-Signature"] = hmacSha256Hex(token, canonicalRequest(url, method, timestamp, bodyHash));
    }
    if (config.upload.registrationSecret) {
      headers["X-Registration-Secret"] = config.upload.registrationSecret;
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

  function tokenSuffix(deviceToken, length) {
    var clean = String(deviceToken || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    return clean.substring(0, length || 12) || "unknown";
  }

  function sanitizeDeviceCode(value) {
    value = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
    if (value.length > 48) {
      value = value.substring(0, 48);
    }
    return value;
  }

  function getAndroidId() {
    try {
      var resolver = typeof context !== "undefined" && context && context.getContentResolver ? context.getContentResolver() : null;
      if (resolver && typeof android !== "undefined" && android && android.provider && android.provider.Settings && android.provider.Settings.Secure) {
        return String(android.provider.Settings.Secure.getString(resolver, android.provider.Settings.Secure.ANDROID_ID) || "");
      }
    } catch (error) {
    }
    return "";
  }

  function stablePhysicalDeviceCode(token) {
    var androidId = sanitizeDeviceCode(getAndroidId());
    if (androidId && androidId !== "9774d56d682e549c" && androidId !== "unknown") {
      return "device_" + androidId;
    }
    return "device_" + tokenSuffix(token, 12);
  }

  function isGenericDeviceId(deviceId) {
    return !deviceId || deviceId === "android_001" || deviceId === "unknown" || deviceId === "device_local_placeholder";
  }

  function getDeviceStore() {
    return storages.create("AgriVideoCollectorDevice");
  }

  function removeStoreValue(store, key) {
    try {
      if (store.remove) {
        store.remove(key);
        return;
      }
    } catch (error) {
    }
    try {
      store.put(key, "");
    } catch (error2) {
    }
  }

  function ensureDeviceIdentityReset() {
    var resetKey = config.upload.deviceIdentityResetKey || "";
    if (!resetKey) {
      return;
    }
    try {
      var store = getDeviceStore();
      var appliedKey = store.get("deviceIdentityResetKey", "");
      if (appliedKey === resetKey) {
        return;
      }
      removeStoreValue(store, "deviceToken");
      removeStoreValue(store, "registrationReady");
      removeStoreValue(store, "registrationCheckedAt");
      removeStoreValue(store, "lastRegisteredDeviceId");
      removeStoreValue(store, "lastRegistrationStatusCode");
      removeStoreValue(store, "lastRegistrationMessage");
      store.put("deviceIdentityResetKey", resetKey);
      config.device.deviceToken = "";
      config.device.registrationReady = false;
      logger.warn("device token reset applied; stable device id preserved", { resetKey: resetKey });
    } catch (error) {
      logger.warn("device identity reset failed", { resetKey: resetKey, message: String(error) });
    }
  }

  function ensureDeviceToken() {
    ensureDeviceIdentityReset();
    if (config.device.deviceToken) {
      return config.device.deviceToken;
    }
    try {
      var store = getDeviceStore();
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

  function ensureDeviceIdentity() {
    var token = ensureDeviceToken();
    try {
      var store = getDeviceStore();
      var storedDeviceId = store.get("deviceId", "");
      if (storedDeviceId && !isGenericDeviceId(storedDeviceId)) {
        config.device.deviceId = storedDeviceId;
        return storedDeviceId;
      }

      var configuredDeviceId = config.device.deviceId || "";
      var deviceId = isGenericDeviceId(configuredDeviceId) ? stablePhysicalDeviceCode(token) : configuredDeviceId;
      store.put("deviceId", deviceId);
      config.device.deviceId = deviceId;
      return deviceId;
    } catch (error) {
      if (isGenericDeviceId(config.device.deviceId)) {
        config.device.deviceId = stablePhysicalDeviceCode(token);
      }
      logger.warn("device id persistence failed; using token-derived id", { message: String(error), deviceId: config.device.deviceId });
      return config.device.deviceId;
    }
  }

  function setRegistrationState(success, result) {
    try {
      var store = getDeviceStore();
      store.put("registrationReady", success ? "true" : "false");
      store.put("registrationCheckedAt", new Date().toISOString());
      if (success) {
        store.put("lastRegisteredDeviceId", config.device.deviceId || "");
      }
      if (result && result.statusCode) {
        store.put("lastRegistrationStatusCode", String(result.statusCode));
      }
      if (result && result.message) {
        store.put("lastRegistrationMessage", String(result.message).slice(0, 200));
      }
    } catch (error) {
    }
    config.device.registrationReady = success === true;
  }

  function isRegistered() {
    if (config.device.registrationReady === true) {
      return true;
    }
    try {
      return getDeviceStore().get("registrationReady", "") === "true" &&
        !!config.device.deviceId &&
        !isGenericDeviceId(config.device.deviceId);
    } catch (error) {
      return false;
    }
  }

  function registerDeviceToken() {
    if (!config.upload.enabled) {
      return { enabled: false, success: false, message: "upload disabled" };
    }
    var token = ensureDeviceToken();
    var deviceId = ensureDeviceIdentity();
    try {
      var response = postJson(endpoint("/mobile/device-token/register"), {
        deviceId: deviceId,
        platform: config.task.platform,
        appVersion: config.app.version,
        registrationSecret: config.upload.registrationSecret || "",
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
      var responsePayload = {};
      try {
        responsePayload = JSON.parse(body || "{}");
      } catch (parseError) {
        responsePayload = {};
      }
      if (response.statusCode >= 200 && response.statusCode < 300 && responsePayload.deviceCode) {
        config.device.deviceId = responsePayload.deviceCode;
        try {
          getDeviceStore().put("deviceId", responsePayload.deviceCode);
        } catch (storeError) {
          logger.warn("backend device id persistence failed", { message: String(storeError), deviceId: responsePayload.deviceCode });
        }
      }
      logger.info("device token registration completed", {
        statusCode: response.statusCode,
        body: body,
        deviceId: config.device.deviceId
      });
      var result = {
        enabled: true,
        success: response.statusCode >= 200 && response.statusCode < 300,
        statusCode: response.statusCode,
        body: body,
        deviceId: config.device.deviceId
      };
      setRegistrationState(result.success, result);
      return result;
    } catch (error) {
      logger.warn("device token registration failed", { message: String(error), deviceId: config.device.deviceId });
      var failure = {
        enabled: true,
        success: false,
        message: String(error),
        deviceId: config.device.deviceId
      };
      setRegistrationState(false, failure);
      return failure;
    }
  }

  function postJson(url, payload) {
    var bodyText = JSON.stringify(payload || {});
    return http.postJson(url, payload, {
      timeout: config.upload.timeoutMs,
        headers: requestHeaders(url, "POST", bodyText, { includeDeviceToken: url.indexOf("/mobile/device-token/register") >= 0 })
    });
  }

  function getJson(url) {
    return http.get(url, {
      timeout: config.upload.timeoutMs,
        headers: requestHeaders(url, "GET", "")
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
    if (!isRegistered()) {
      return { enabled: true, success: false, skipped: true, message: "device not registered" };
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
      var normalizedLevel = String(level || "INFO").toUpperCase();
      if (normalizedLevel !== "INFO" && normalizedLevel !== "WARN" && normalizedLevel !== "ERROR") {
        normalizedLevel = "INFO";
      }
      var normalizedMessage = String(message || "runtime log");
      var normalizedContext = context && typeof context === "object" ? context : {};
      var stopReason = normalizedContext.stopReason ? String(normalizedContext.stopReason) : undefined;
      var payload = {
        taskId: config.task.taskId,
        deviceId: config.device.deviceId || ensureDeviceIdentity(),
        level: normalizedLevel,
        message: normalizedMessage,
        context: normalizedContext,
        stopReason: stopReason,
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

  function uploadLiveCommentAction(action) {
    if (!config.upload.enabled) {
      return { enabled: false, success: false, message: "upload disabled" };
    }

    try {
      action = action || {};
      var payload = {
        taskId: action.taskId || config.task.taskId,
        deviceId: action.deviceId || config.device.deviceId,
        platform: action.platform || config.task.platform || "douyin",
        triggerEventId: action.triggerEventId,
        roomName: action.roomName || "",
        leaderAccountName: action.leaderAccountName || action.triggerAuthor || "",
        triggerText: action.triggerText || "",
        matchedKeywords: action.matchedKeywords || [],
        replyText: action.replyText || "(skipped)",
        plannedDelayMs: action.plannedDelayMs,
        status: action.status || "planned",
        skipReason: action.skipReason || "",
        failureReason: action.failureReason || "",
        rawPayload: action,
        plannedAt: action.plannedAt,
        sentAt: action.sentAt,
        reportedAt: new Date().toISOString()
      };
      var response = postJson(endpoint("/mobile/live-comment-actions"), payload);
      var responseBody = response.body ? response.body.string() : "";
      var success = response.statusCode >= 200 && response.statusCode < 300;
      if (!success) {
        logger.warn("直播评论执行记录上传失败", {
          statusCode: response.statusCode,
          body: responseBody,
          triggerEventId: payload.triggerEventId
        });
      }
      return {
        enabled: true,
        success: success,
        statusCode: response.statusCode,
        body: responseBody
      };
    } catch (error) {
      logger.warn("直播评论执行记录上传异常", { message: String(error) });
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

  var retryCachedRunning = false;

  function retryCached() {
    if (!config.upload.enabled || !config.upload.retryCachedOnStart) {
      return;
    }
    if (retryCachedRunning) {
      logger.info("缓存候选记录补传已在运行，跳过本轮");
      return;
    }
    retryCachedRunning = true;

    try {
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
    } finally {
      retryCachedRunning = false;
    }
  }

  function pollCommands(deviceId) {
    if (!config.upload.controlEnabled) {
      return [];
    }
    if (!isRegistered()) {
      if (shouldLogRequestStart("pollCommandsUnregistered")) {
        logger.warn("skip command polling before device registration", { deviceId: deviceId || config.device.deviceId || "" });
      }
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

  function ensureDir(path) {
    if (!files.exists(path)) {
      files.createWithDirs(path + "/.keep");
      files.remove(path + "/.keep");
    }
  }

  function deletePath(path) {
    if (!path || !files.exists(path)) {
      return;
    }
    try {
      files.removeDir(path);
      return;
    } catch (error) {
    }
    try {
      files.remove(path);
    } catch (error2) {
    }
  }

  function downloadFile(url, targetPath) {
    var response = http.get(url, {
      timeout: Math.max(15000, Number(config.upload.timeoutMs || 5000) * 4),
      headers: requestHeaders(url, "GET", "")
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      var body = response.body ? response.body.string() : "";
      throw new Error("download failed: " + response.statusCode + " " + body.slice(0, 160));
    }
    var bytes = response.body.bytes();
    files.writeBytes(targetPath, bytes);
    return bytes.length;
  }

  function unzipFile(zipPath, targetDir) {
    ensureDir(targetDir);
    var input = new java.util.zip.ZipInputStream(new java.io.BufferedInputStream(new java.io.FileInputStream(zipPath)));
    var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
    try {
      var entry = input.getNextEntry();
      while (entry !== null) {
        var entryName = String(entry.getName() || "").replace(/\\/g, "/");
        if (entryName.indexOf("..") >= 0 || entryName.charAt(0) === "/") {
          throw new Error("unsafe zip entry: " + entryName);
        }
        var outputPath = files.join(targetDir, entryName);
        if (entry.isDirectory()) {
          ensureDir(outputPath);
        } else {
          var outputFile = new java.io.File(outputPath);
          var parent = outputFile.getParentFile();
          if (parent && !parent.exists()) {
            parent.mkdirs();
          }
          var output = new java.io.BufferedOutputStream(new java.io.FileOutputStream(outputFile));
          try {
            var count = input.read(buffer);
            while (count > 0) {
              output.write(buffer, 0, count);
              count = input.read(buffer);
            }
          } finally {
            output.close();
          }
        }
        input.closeEntry();
        entry = input.getNextEntry();
      }
    } finally {
      input.close();
    }
  }

  function findUpdateSourceDir(extractDir) {
    var directMain = files.join(extractDir, "main.js");
    if (files.exists(directMain)) {
      return extractDir;
    }
    var names = files.listDir(extractDir) || [];
    for (var i = 0; i < names.length; i++) {
      var candidate = files.join(extractDir, names[i]);
      if (files.exists(files.join(candidate, "main.js"))) {
        return candidate;
      }
    }
    throw new Error("update package missing main.js");
  }

  function copyDirContents(sourceDir, targetDir) {
    ensureDir(targetDir);
    var names = files.listDir(sourceDir) || [];
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name === "datasource") {
        continue;
      }
      var sourcePath = files.join(sourceDir, name);
      var targetPath = files.join(targetDir, name);
      var sourceFile = new java.io.File(sourcePath);
      if (sourceFile.isDirectory()) {
        deletePath(targetPath);
        copyDirContents(sourcePath, targetPath);
      } else {
        var parent = new java.io.File(targetPath).getParentFile();
        if (parent && !parent.exists()) {
          parent.mkdirs();
        }
        if (files.exists(targetPath)) {
          files.remove(targetPath);
        }
        files.copy(sourcePath, targetPath);
      }
    }
  }

  function applyAgentUpdate(versionResult, options) {
    options = options || {};
    var latest = versionResult && versionResult.latestVersion;
    if (!latest || !latest.packageUrl || !latest.version) {
      return { applied: false, message: "no update package" };
    }
    var scriptDir = options.scriptDir || (config.runtime && config.runtime.scriptDir) || files.cwd();
    var updateRoot = files.join(config.output && config.output.baseDir || scriptDir, "agent-update");
    var workDir = files.join(updateRoot, "work-" + latest.version + "-" + Date.now());
    var zipPath = files.join(workDir, "package.zip");
    var extractDir = files.join(workDir, "extract");

    logger.warn("开始自动更新手机 Agent", {
      fromVersion: config.app.version,
      toVersion: latest.version,
      packageUrl: latest.packageUrl,
      forceUpdate: !!versionResult.forceUpdate
    });
    uploadAgentUpdateEvent({
      eventType: "DOWNLOADING",
      fromVersion: config.app.version,
      toVersion: latest.version,
      message: "downloading update package",
      payload: { packageUrl: latest.packageUrl, forceUpdate: !!versionResult.forceUpdate }
    });

    ensureDir(workDir);
    var size = downloadFile(latest.packageUrl, zipPath);
    var actualSha256 = sha256FileHex(zipPath);
    if (latest.sha256 && String(latest.sha256).toLowerCase() !== actualSha256) {
      throw new Error("update package sha256 mismatch: expected " + latest.sha256 + ", actual " + actualSha256);
    }

    unzipFile(zipPath, extractDir);
    var sourceDir = findUpdateSourceDir(extractDir);
    copyDirContents(sourceDir, scriptDir);
    config.app.version = latest.version;

    uploadAgentUpdateEvent({
      eventType: "APPLIED",
      fromVersion: versionResult.currentVersion || "",
      toVersion: latest.version,
      message: "update package applied",
      payload: {
        packageUrl: latest.packageUrl,
        sha256: actualSha256,
        sizeBytes: size,
        scriptDir: scriptDir
      }
    });
    logger.warn("手机 Agent 自动更新完成", {
      toVersion: latest.version,
      scriptDir: scriptDir,
      sizeBytes: size
    });
    return {
      applied: true,
      version: latest.version,
      sha256: actualSha256,
      sizeBytes: size
    };
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
    uploadLiveCommentAction: uploadLiveCommentAction,
    uploadLogFile: uploadLogFile,
    uploadRecentLogFiles: uploadRecentLogFiles,
    uploadLogFilesByOptions: uploadLogFilesByOptions,
    ensureDeviceToken: ensureDeviceToken,
    registerDeviceToken: registerDeviceToken,
    isRegistered: isRegistered,
    retryCached: retryCached,
    pollCommands: pollCommands,
    ackCommand: ackCommand,
    fetchCurrentTask: fetchCurrentTask,
    checkAgentVersion: checkAgentVersion,
    applyAgentUpdate: applyAgentUpdate,
    uploadAgentUpdateEvent: uploadAgentUpdateEvent
  };
}

module.exports = {
  createUploader: createUploader
};
