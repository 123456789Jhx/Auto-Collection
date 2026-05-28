"auto";

var __modules__ = {};
var __cache__ = {};
function __require__(id) {
  id = id.replace(/\\/g, "/");
  if (__cache__[id]) {
    return __cache__[id].exports;
  }
  if (!__modules__[id]) {
    throw new Error("Bundled module not found: " + id);
  }
  var module = { exports: {} };
  __cache__[id] = module;
  __modules__[id](module, module.exports);
  return module.exports;
}
__modules__["config.js"] = function(module, exports) {
module.exports = {
  app: {
    name: "AgriVideoCollector",
    version: "0.1.0"
  },

  device: {
    deviceId: "android_001"
  },

  task: {
    taskId: "task_local_001",
    platform: "douyin",
    mode: "feed", // feed | search
    keywords: [
      "水稻病虫害",
      "玉米高产",
      "小麦赤霉病",
      "大棚蔬菜",
      "果树修剪"
    ],
    maxVideos: 100,
    maxCaptures: 30,
    staySecondsMin: 5,
    staySecondsMax: 12,
    collectComments: true,
    commentLimit: 10,
    captureMode: "all", // matched | all，调试期建议 all，避免漏采
    saveScreenshots: false
  },

  schedule: {
    enabled: true,
    videoMinutesPerDay: 120,
    liveMinutesPerDay: 60,
    autoStart: false
  },

  match: {
    agricultureKeywords: [
      "水稻",
      "玉米",
      "小麦",
      "大豆",
      "果树",
      "蔬菜",
      "大棚",
      "育苗",
      "灌溉",
      "土壤",
      "病虫害",
      "农药",
      "肥料",
      "除草剂",
      "农机",
      "收割机",
      "拖拉机",
      "养殖",
      "猪场",
      "牛羊",
      "鸡鸭",
      "饲料",
      "防疫",
      "疫苗",
      "兽药"
    ],
    marketingKeywords: ["招商", "加盟", "卖课", "收徒", "代理", "私信领取"],
    lowPriorityKeywords: ["娱乐", "明星", "八卦", "游戏", "搞笑"]
  },

  output: {
    useProjectDir: true,
    folderName: "datasource",
    fixedBaseDir: "/storage/emulated/0/安卓群控/autojs/datasource",
    baseDir: "",
    cacheDir: "",
    screenshotDir: "",
    logDir: "",
    xmlDir: "",
    writeLogFile: true
  },

  upload: {
    enabled: false,
    url: "http://127.0.0.1:8080/api/mobile/video-captures",
    timeoutMs: 15000,
    retryCachedOnStart: true
  },

  runtime: {
    ocrRetryCount: 3,
    recoverRetryCount: 2,
    swipeDurationMs: 450,
    loopIntervalMs: 800,
    riskWords: ["验证码", "安全验证", "登录", "账号异常", "访问过于频繁", "稍后再试"]
  }
};

};
__modules__["core/logger.js"] = function(module, exports) {
function ensureDir(dirPath) {
  if (!files.exists(dirPath)) {
    files.createWithDirs(dirPath + "/.keep");
    files.remove(dirPath + "/.keep");
  }
}

function pad(value) {
  return value < 10 ? "0" + value : "" + value;
}

function datePart(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-");
}

function timePart(date) {
  return [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(":");
}

function createLogger(config) {
  var logFile = "";
  if (config.output.writeLogFile) {
    ensureDir(config.output.logDir);
    logFile = config.output.logDir + "/" + datePart(new Date()) + ".log";
  }

  function write(level, message, extra) {
    var now = new Date();
    var line = "[" + datePart(now) + " " + timePart(now) + "] [" + level + "] " + message;
    if (extra !== undefined) {
      try {
        line += " " + JSON.stringify(extra);
      } catch (error) {
        line += " " + extra;
      }
    }
    console.log(line);
    if (config.output.writeLogFile && logFile) {
      files.append(logFile, line + "\n");
    }
  }

  return {
    debug: function (message, extra) {
      write("DEBUG", message, extra);
    },
    info: function (message, extra) {
      write("INFO", message, extra);
    },
    warn: function (message, extra) {
      write("WARN", message, extra);
    },
    error: function (message, extra) {
      write("ERROR", message, extra);
    }
  };
}

module.exports = {
  createLogger: createLogger
};

};
__modules__["core/permission.js"] = function(module, exports) {
function createPermissionManager(config, logger) {
  function waitForAccessibility() {
    if (auto.service) {
      return true;
    }

    logger.warn("无障碍服务未开启，跳转设置页");
    toast("请开启无障碍服务后返回脚本");
    app.startActivity({
      action: "android.settings.ACCESSIBILITY_SETTINGS"
    });

    for (var i = 0; i < 60; i++) {
      sleep(1000);
      if (auto.service) {
        logger.info("无障碍服务已开启");
        return true;
      }
    }

    logger.error("等待无障碍服务超时");
    return false;
  }

  function ensureCapturePermission() {
    logger.info("请求截图权限");
    var granted = requestScreenCapture(false);
    if (!granted) {
      logger.error("截图权限请求失败");
      toast("截图权限失败，任务停止");
      return false;
    }
    logger.info("截图权限已获得");
    return true;
  }

  function ensureOutputDirs() {
    var dirs = [
      config.output.baseDir,
      config.output.cacheDir
    ];
    if (config.task.saveScreenshots) {
      dirs.push(config.output.screenshotDir);
    }
    if (config.output.writeLogFile) {
      dirs.push(config.output.logDir);
    }
    dirs.forEach(function (dirPath) {
      if (!files.exists(dirPath)) {
        files.createWithDirs(dirPath + "/.keep");
        files.remove(dirPath + "/.keep");
      }
    });
    return true;
  }

  function ensureAll() {
    ensureOutputDirs();
    if (!waitForAccessibility()) {
      return false;
    }
    if (!ensureCapturePermission()) {
      return false;
    }
    return true;
  }

  return {
    ensureAll: ensureAll
  };
}

module.exports = {
  createPermissionManager: createPermissionManager
};

};
__modules__["core/storage.js"] = function(module, exports) {
function ensureDir(dirPath) {
  if (!files.exists(dirPath)) {
    files.createWithDirs(dirPath + "/.keep");
    files.remove(dirPath + "/.keep");
  }
}

function safeName(value) {
  return String(value || "unknown").replace(/[^\w.-]+/g, "_");
}

function nowCompact() {
  var date = new Date();
  function pad(value) {
    return value < 10 ? "0" + value : "" + value;
  }
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    "_",
    date.getMilliseconds()
  ].join("");
}

function createStorage(config, logger) {
  ensureDir(config.output.baseDir);
  ensureDir(config.output.cacheDir);

  function saveCandidate(candidate) {
    var fileName = safeName(candidate.taskId) + "_" + nowCompact() + ".json";
    var filePath = config.output.cacheDir + "/" + fileName;
    files.write(filePath, JSON.stringify(candidate, null, 2));
    logger.info("候选记录已写入本地缓存", { filePath: filePath });
    return filePath;
  }

  function saveScreenshot(image, scene) {
    if (!config.task.saveScreenshots) {
      return "";
    }
    if (!image) {
      return "";
    }
    ensureDir(config.output.screenshotDir);
    var fileName = safeName(scene || "screen") + "_" + nowCompact() + ".png";
    var filePath = config.output.screenshotDir + "/" + fileName;
    images.save(image, filePath, "png", 100);
    logger.info("截图已保存", { filePath: filePath });
    return filePath;
  }

  function listCachedCandidates() {
    ensureDir(config.output.cacheDir);
    return files
      .listDir(config.output.cacheDir, function (name) {
        return name.endsWith(".json") && !name.endsWith(".uploaded.json");
      })
      .map(function (name) {
        return config.output.cacheDir + "/" + name;
      });
  }

  function readJson(filePath) {
    return JSON.parse(files.read(filePath));
  }

  function markUploaded(filePath) {
    var targetPath = filePath.replace(/\.json$/, ".uploaded.json");
    files.rename(filePath, files.getName(targetPath));
    return targetPath;
  }

  return {
    saveCandidate: saveCandidate,
    saveScreenshot: saveScreenshot,
    listCachedCandidates: listCachedCandidates,
    readJson: readJson,
    markUploaded: markUploaded
  };
}

module.exports = {
  createStorage: createStorage
};

};
__modules__["core/uploader.js"] = function(module, exports) {
function createUploader(config, logger, storage) {
  function upload(candidate) {
    if (!config.upload.enabled) {
      return {
        enabled: false,
        success: false,
        message: "upload disabled"
      };
    }

    try {
      var response = http.postJson(config.upload.url, candidate, {
        timeout: config.upload.timeoutMs
      });
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

  return {
    upload: upload,
    retryCached: retryCached
  };
}

module.exports = {
  createUploader: createUploader
};

};
__modules__["core/ocr.js"] = function(module, exports) {
function createOcr(config, logger) {
  function normalizeResult(result) {
    if (!result) {
      return "";
    }

    if (typeof result === "string") {
      return result;
    }

    if (Array.isArray(result)) {
      return result
        .map(function (item) {
          if (typeof item === "string") {
            return item;
          }
          return item.text || item.label || "";
        })
        .filter(Boolean)
        .join("\n");
    }

    if (result.text) {
      return result.text;
    }

    if (result.results) {
      return normalizeResult(result.results);
    }

    return "";
  }

  function recognize(image) {
    if (!image) {
      return "";
    }

    for (var i = 0; i < config.runtime.ocrRetryCount; i++) {
      try {
        if (typeof ocr !== "undefined" && ocr.recognize) {
          return normalizeResult(ocr.recognize(image));
        }

        if (typeof paddle !== "undefined" && paddle.ocr) {
          return normalizeResult(paddle.ocr(image));
        }

        if (typeof $ocr !== "undefined" && $ocr.recognize) {
          var deferred = $ocr.recognize(image);
          return normalizeResult(deferred);
        }

        logger.warn("当前运行环境未发现可用 OCR API");
        return "";
      } catch (error) {
        logger.warn("OCR 识别失败，准备重试", {
          attempt: i + 1,
          message: String(error)
        });
        sleep(500);
      }
    }

    return "";
  }

  function captureAndRecognize() {
    var image = captureScreen();
    var text = recognize(image);
    return {
      image: image,
      text: text
    };
  }

  return {
    recognize: recognize,
    captureAndRecognize: captureAndRecognize
  };
}

module.exports = {
  createOcr: createOcr
};

};
__modules__["core/matcher.js"] = function(module, exports) {
function containsAny(text, words) {
  if (!text || !words) {
    return [];
  }

  return words.filter(function (word) {
    return word && text.indexOf(word) >= 0;
  });
}

function createMatcher(config) {
  function evaluate(text) {
    var agricultureHits = containsAny(text, config.match.agricultureKeywords);
    var marketingHits = containsAny(text, config.match.marketingKeywords);
    var lowPriorityHits = containsAny(text, config.match.lowPriorityKeywords);

    var priority = "none";
    if (agricultureHits.length > 0) {
      priority = "normal";
    }
    if (agricultureHits.length >= 2) {
      priority = "high";
    }
    if (marketingHits.length > 0) {
      priority = "marketing";
    }
    if (lowPriorityHits.length > 0 && agricultureHits.length === 0) {
      priority = "low";
    }

    return {
      matched: agricultureHits.length > 0,
      priority: priority,
      agricultureHits: agricultureHits,
      marketingHits: marketingHits,
      lowPriorityHits: lowPriorityHits
    };
  }

  return {
    evaluate: evaluate
  };
}

module.exports = {
  createMatcher: createMatcher
};

};
__modules__["utils/autojs-utils.js"] = function(module, exports) {
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleepRandom(minMs, maxMs) {
  sleep(randomInt(minMs, maxMs));
}

function waitForElement(selector, timeoutMs, region, logger) {
  var endTime = Date.now() + (timeoutMs || 5000);

  while (Date.now() <= endTime) {
    try {
      var node = region
        ? selector.boundsInside(region.x1, region.y1, region.x2, region.y2).findOne(100)
        : selector.findOne(100);
      if (node) {
        return node;
      }
    } catch (error) {
      if (logger) {
        logger.warn("查找控件异常", { message: String(error) });
      }
    }
    sleep(100);
  }

  return null;
}

function safeClick(node, maxDepth, logger) {
  if (!node) {
    return false;
  }

  var depthLimit = maxDepth || 3;

  try {
    if (node.clickable && node.clickable() && node.click()) {
      sleepRandom(500, 1000);
      return true;
    }
  } catch (error) {
    if (logger) {
      logger.debug("直接点击控件失败", { message: String(error) });
    }
  }

  try {
    var parent = node.parent();
    var depth = 1;
    while (parent && depth <= depthLimit) {
      if (parent.clickable && parent.clickable() && parent.click()) {
        sleepRandom(500, 1000);
        return true;
      }
      parent = parent.parent();
      depth += 1;
    }
  } catch (error) {
    if (logger) {
      logger.debug("点击父节点失败", { message: String(error) });
    }
  }

  return axisClick(node, logger);
}

function axisClick(node, logger) {
  if (!node || !node.bounds) {
    return false;
  }

  var bounds = node.bounds();
  if (!bounds || bounds.width() <= 0 || bounds.height() <= 0) {
    return false;
  }

  if (bounds.right < 0 || bounds.bottom < 0 || bounds.top > device.height) {
    return false;
  }

  var x = bounds.centerX() + randomInt(-2, 2);
  var y = bounds.centerY() + randomInt(-2, 2);
  x = Math.max(0, Math.min(x, device.width));
  y = Math.max(0, Math.min(y, device.height));

  if (logger) {
    logger.debug("坐标点击控件", { x: x, y: y });
  }

  press(x, y, randomInt(100, 160));
  sleepRandom(500, 1000);
  return true;
}

function clickPoint(x, y) {
  press(
    randomInt(Math.floor(x - 8), Math.floor(x + 8)),
    randomInt(Math.floor(y - 8), Math.floor(y + 8)),
    randomInt(90, 160)
  );
  sleepRandom(500, 1000);
}

function getCurrentPackageName() {
  try {
    var windows = auto.windows;
    for (var i = 0; i < windows.length; i++) {
      var window = windows[i];
      if (window.getType() === 1 && window.isFocused()) {
        return app.getPackageName(window.getTitle());
      }
    }
  } catch (error) {
    return currentPackage();
  }
  return currentPackage();
}

function verifyApp(appName, logger) {
  var expectedPackage = app.getPackageName(appName);
  var actualPackage = getCurrentPackageName();
  if (actualPackage !== expectedPackage) {
    var message = "当前应用不是 " + appName + "，当前包名：" + actualPackage;
    if (logger) {
      logger.warn(message);
    }
    return false;
  }
  return true;
}

function clickIfExists(selector, timeoutMs, logger) {
  var node = waitForElement(selector, timeoutMs || 1000, null, logger);
  if (!node) {
    return false;
  }
  return safeClick(node, 3, logger);
}

module.exports = {
  randomInt: randomInt,
  sleepRandom: sleepRandom,
  waitForElement: waitForElement,
  safeClick: safeClick,
  axisClick: axisClick,
  clickPoint: clickPoint,
  getCurrentPackageName: getCurrentPackageName,
  verifyApp: verifyApp,
  clickIfExists: clickIfExists
};

};
__modules__["utils/xml-dumper.js"] = function(module, exports) {
function escapeXml(value) {
  if (!value) {
    return "";
  }
  return String(value).replace(/[<>&'"]/g, function (char) {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case "\"":
        return "&quot;";
      default:
        return char;
    }
  });
}

function nodeToXml(node, depth) {
  if (!node) {
    return "";
  }

  var indent = new Array(depth + 1).join("  ");
  var xml = indent + "<node";
  var classNameValue = node.className && node.className();
  var textValue = node.text && node.text();
  var descValue = node.desc && node.desc();
  var idValue = node.id && node.id();
  var boundsValue = node.bounds && node.bounds();

  if (classNameValue) {
    xml += ' class="' + escapeXml(classNameValue) + '"';
  }
  if (textValue) {
    xml += ' text="' + escapeXml(textValue) + '"';
  }
  if (descValue) {
    xml += ' content-desc="' + escapeXml(descValue) + '"';
  }
  if (idValue) {
    xml += ' resource-id="' + escapeXml(idValue) + '"';
  }
  if (boundsValue) {
    xml +=
      ' bounds="[' +
      boundsValue.left +
      "," +
      boundsValue.top +
      "][" +
      boundsValue.right +
      "," +
      boundsValue.bottom +
      ']"';
  }

  if (node.clickable && node.clickable()) {
    xml += ' clickable="true"';
  }
  if (node.enabled && node.enabled()) {
    xml += ' enabled="true"';
  }
  if (node.scrollable && node.scrollable()) {
    xml += ' scrollable="true"';
  }

  var childCount = node.childCount ? node.childCount() : 0;
  if (childCount > 0) {
    xml += ">\n";
    for (var i = 0; i < childCount; i++) {
      xml += nodeToXml(node.child(i), depth + 1);
    }
    xml += indent + "</node>\n";
  } else {
    xml += "/>\n";
  }

  return xml;
}

function dumpCurrentXml(outputDir, logger) {
  var root = auto.root;
  if (!root) {
    throw new Error("无法获取当前页面根节点");
  }

  if (!files.exists(outputDir)) {
    files.createWithDirs(outputDir + "/.keep");
    files.remove(outputDir + "/.keep");
  }

  var now = new Date();
  var fileName =
    "page_" +
    now.getFullYear() +
    ("0" + (now.getMonth() + 1)).slice(-2) +
    ("0" + now.getDate()).slice(-2) +
    "_" +
    ("0" + now.getHours()).slice(-2) +
    ("0" + now.getMinutes()).slice(-2) +
    ("0" + now.getSeconds()).slice(-2) +
    ".xml";
  var filePath = outputDir + "/" + fileName;
  var xml = '<?xml version="1.0" encoding="utf-8"?>\n<hierarchy>\n' + nodeToXml(root, 1) + "</hierarchy>";
  files.write(filePath, xml);

  if (logger) {
    logger.info("页面 XML 已导出", { filePath: filePath });
  }
  return filePath;
}

module.exports = {
  dumpCurrentXml: dumpCurrentXml
};

};
__modules__["core/floaty-control.js"] = function(module, exports) {
function createFloatyControl(config, logger) {
  var dumpCurrentXml = __require__("utils/xml-dumper.js").dumpCurrentXml;

  var state = {
    running: false,
    paused: true,
    skipRequested: false,
    manualCaptureRequested: false,
    stopRequested: false,
    viewedCount: 0,
    capturedCount: 0,
    lastMessage: "待启动",
    compact: false
  };

  var window = null;

  function renderStatus() {
    if (!window) {
      return;
    }
    ui.run(function () {
      window.status.setVisibility(state.compact ? 8 : 0);
      window.row1.setVisibility(state.compact ? 8 : 0);
      window.row2.setVisibility(state.compact ? 8 : 0);
      window.mini.setVisibility(state.compact ? 0 : 8);
      window.mini.setText(state.paused ? "停" : "采");
      window.status.setText(
        "任务: " + config.task.taskId +
          "\n浏览: " + state.viewedCount +
          " 采集: " + state.capturedCount +
          "\n状态: " + state.lastMessage +
          "\n输出: " + config.output.baseDir
      );
    });
  }

  function create() {
    window = floaty.window(
      <vertical bg="#DD222222" padding="8">
        <text id="mini" textColor="#ffffff" textSize="12sp" text="采" w="32" h="32" gravity="center" bg="#AA2E7D32" visibility="gone" />
        <text id="status" textColor="#ffffff" textSize="12sp" text="待启动" />
        <horizontal id="row1">
          <button id="start" text="开始" w="52" h="40" />
          <button id="pause" text="暂停" w="52" h="40" />
          <button id="skip" text="跳过" w="52" h="40" />
        </horizontal>
        <horizontal id="row2">
          <button id="capture" text="采集" w="52" h="40" />
          <button id="dump" text="XML" w="52" h="40" />
          <button id="stop" text="停止" w="52" h="40" />
        </horizontal>
      </vertical>
    );

    window.setPosition(20, 180);

    window.mini.click(function () {
      state.compact = false;
      state.lastMessage = "控制台展开";
      renderStatus();
    });

    window.start.click(function () {
      state.running = true;
      state.paused = false;
      state.lastMessage = "运行中";
      logger.info("悬浮窗开始任务");
      renderStatus();
    });

    window.pause.click(function () {
      state.paused = !state.paused;
      state.lastMessage = state.paused ? "已暂停" : "运行中";
      logger.info("悬浮窗切换暂停状态", { paused: state.paused });
      renderStatus();
    });

    window.skip.click(function () {
      state.skipRequested = true;
      state.lastMessage = "请求跳过";
      logger.info("悬浮窗请求跳过");
      renderStatus();
    });

    window.capture.click(function () {
      state.manualCaptureRequested = true;
      state.lastMessage = "请求手动采集";
      logger.info("悬浮窗请求手动采集");
      renderStatus();
    });

    window.dump.click(function () {
      try {
        var filePath = dumpCurrentXml(config.output.xmlDir, logger);
        state.lastMessage = "XML已导出";
        toast("XML已保存: " + filePath);
      } catch (error) {
        state.lastMessage = "XML导出失败";
        logger.warn("页面 XML 导出失败", { message: String(error) });
      }
      renderStatus();
    });

    window.stop.click(function () {
      state.stopRequested = true;
      state.running = false;
      state.lastMessage = "停止中";
      logger.info("悬浮窗请求停止");
      renderStatus();
    });

    renderStatus();
  }

  function update(patch) {
    Object.keys(patch || {}).forEach(function (key) {
      state[key] = patch[key];
    });
    renderStatus();
  }

  function consumeSkip() {
    var value = state.skipRequested;
    state.skipRequested = false;
    return value;
  }

  function consumeManualCapture() {
    var value = state.manualCaptureRequested;
    state.manualCaptureRequested = false;
    return value;
  }

  function compact(message) {
    state.compact = true;
    if (message) {
      state.lastMessage = message;
    }
    renderStatus();
    sleep(250);
  }

  function expand(message) {
    state.compact = false;
    if (message) {
      state.lastMessage = message;
    }
    renderStatus();
    sleep(150);
  }

  return {
    create: create,
    update: update,
    compact: compact,
    expand: expand,
    consumeSkip: consumeSkip,
    consumeManualCapture: consumeManualCapture,
    state: state
  };
}

module.exports = {
  createFloatyControl: createFloatyControl
};

};
__modules__["platforms/douyin.js"] = function(module, exports) {
function createDouyinAdapter(config, logger, ocrEngine) {
  var autojsUtils = __require__("utils/autojs-utils.js");
  var packageName = "com.ss.android.ugc.aweme";

  function dismissStartupPopups() {
    autojsUtils.clickIfExists(textMatches(/.*(允许).*/).clickable(true), 1500, logger);

    var starCardNode =
      autojsUtils.waitForElement(textContains("玩转抖音星卡"), 1000, null, logger) ||
      autojsUtils.waitForElement(descContains("玩转抖音星卡"), 1000, null, logger);
    if (starCardNode) {
      logger.warn("检测到抖音活动 WebView，尝试返回首页");
      back();
      autojsUtils.sleepRandom(1200, 2000);
    }

    var tipNode = autojsUtils.waitForElement(text("温馨提示"), 1500, null, logger);
    if (tipNode) {
      autojsUtils.clickPoint(device.width / 2, device.height * 0.85);
    }

    var continueEditNode = autojsUtils.waitForElement(text("继续编辑作品吗？"), 1500, null, logger);
    if (continueEditNode) {
      autojsUtils.clickIfExists(desc("取消"), 1000, logger);
      autojsUtils.clickIfExists(text("取消"), 1000, logger);
    }
  }

  function openApp() {
    logger.info("打开抖音");
    home();
    autojsUtils.sleepRandom(1000, 2000);

    var launched = app.launchApp("抖音") || app.launchPackage(packageName);
    if (!launched) {
      throw new Error("抖音打开失败");
    }

    autojsUtils.sleepRandom(3000, 5000);
    dismissStartupPopups();
    autojsUtils.sleepRandom(2000, 4000);

    var homeNode =
      autojsUtils.waitForElement(text("首页"), 6000, null, logger) ||
      autojsUtils.waitForElement(desc("首页"), 2000, null, logger);
    if (!homeNode) {
      logger.warn("未检测到抖音首页控件，继续尝试执行");
    }
    return !!launched;
  }

  function openSearch(keyword) {
    logger.info("尝试进入抖音搜索", { keyword: keyword });
    autojsUtils.verifyApp("抖音", logger);

    var searchNode =
      autojsUtils.waitForElement(desc("搜索"), 3000, null, logger) ||
      autojsUtils.waitForElement(descContains("搜索"), 2000, null, logger) ||
      autojsUtils.waitForElement(text("搜索"), 2000, null, logger) ||
      autojsUtils.waitForElement(textContains("搜索"), 2000, null, logger);

    if (searchNode) {
      autojsUtils.safeClick(searchNode, 3, logger);
      autojsUtils.sleepRandom(1200, 2000);
      setText(keyword);
      autojsUtils.sleepRandom(1000, 1500);

      var searchButton =
        autojsUtils.waitForElement(text("搜索"), 3000, null, logger) ||
        autojsUtils.waitForElement(desc("搜索"), 1000, null, logger);
      if (searchButton) {
        autojsUtils.axisClick(searchButton, logger);
      } else {
        press("enter");
      }
      autojsUtils.sleepRandom(2500, 4000);
      return true;
    }
    logger.warn("未找到搜索入口，保留在当前页面");
    return false;
  }

  function enterVideoFeed() {
    logger.info("进入视频流");
    sleep(1500);
    return true;
  }

  function enterLiveFeed(keyword) {
    logger.info("进入直播流", { keyword: keyword });
    openSearch(keyword || "农业");

    var liveTab =
      autojsUtils.waitForElement(text("直播"), 4000, null, logger) ||
      autojsUtils.waitForElement(desc("直播"), 2000, null, logger) ||
      autojsUtils.waitForElement(textContains("直播"), 2000, null, logger);
    if (liveTab) {
      autojsUtils.safeClick(liveTab, 3, logger);
      autojsUtils.sleepRandom(2500, 4000);
      return true;
    }

    logger.warn("未找到直播 Tab，保留在搜索结果流采集");
    return false;
  }

  function extractVisibleText() {
    var texts = [];
    var nodes = className("android.widget.TextView").find();
    for (var i = 0; i < nodes.length; i++) {
      var value = nodes[i].text();
      if (value) {
        texts.push(value);
      }
    }
    return texts.join("\n");
  }

  function extractScreen() {
    var result = ocrEngine.captureAndRecognize();
    var visibleText = extractVisibleText();
    var combinedText = [result.text, visibleText].filter(Boolean).join("\n");
    return {
      image: result.image,
      ocrText: result.text,
      visibleText: visibleText,
      combinedText: combinedText
    };
  }

  function openComments() {
    logger.info("尝试打开评论面板");
    var commentNode =
      autojsUtils.waitForElement(descMatches(/评论|评论区/), 1500, null, logger) ||
      autojsUtils.waitForElement(textMatches(/评论|评论区/), 1500, null, logger);

    if (commentNode) {
      autojsUtils.safeClick(commentNode, 3, logger);
      autojsUtils.sleepRandom(1800, 2600);
      return true;
    }

    var width = device.width;
    var height = device.height;
    autojsUtils.clickPoint(width - 70, Math.floor(height * 0.55));
    autojsUtils.sleepRandom(1800, 2600);
    return true;
  }

  function extractHotComments(limit) {
    var comments = [];
    var nodes = className("android.widget.TextView").find();
    for (var i = 0; i < nodes.length && comments.length < limit; i++) {
      var value = nodes[i].text();
      if (value && value.length >= 2 && value.length <= 120) {
        comments.push(value);
      }
    }
    return comments;
  }

  function closeComments() {
    back();
    autojsUtils.sleepRandom(800, 1200);
  }

  function nextVideo() {
    var width = device.width;
    var height = device.height;
    swipe(
      Math.floor(width * 0.5),
      Math.floor(height * 0.78),
      Math.floor(width * 0.5),
      Math.floor(height * 0.22),
      config.runtime.swipeDurationMs
    );
    autojsUtils.sleepRandom(1200, 2000);
  }

  function recover() {
    logger.warn("执行抖音页面恢复");
    back();
    autojsUtils.sleepRandom(800, 1200);
    enterVideoFeed();
  }

  return {
    openApp: openApp,
    openSearch: openSearch,
    enterVideoFeed: enterVideoFeed,
    enterLiveFeed: enterLiveFeed,
    extractScreen: extractScreen,
    openComments: openComments,
    extractHotComments: extractHotComments,
    closeComments: closeComments,
    nextVideo: nextVideo,
    recover: recover
  };
}

module.exports = {
  createDouyinAdapter: createDouyinAdapter
};

};

// ---- main.js ----


function getScriptDir() {
  var candidates = [
    "/storage/emulated/0/脚本",
    "/sdcard/脚本",
    "/storage/emulated/0/脚本/autojs",
    "/sdcard/脚本/autojs",
    "/storage/emulated/0/AgriVideoCollector",
    "/sdcard/AgriVideoCollector",
    "/storage/emulated/0/Download/AgriVideoCollector",
    "/sdcard/Download/AgriVideoCollector"
  ];

  try {
    var cwd = files.cwd();
    if (cwd && files.exists(files.join(cwd, "config.js"))) {
      return cwd;
    }
  } catch (error) {
  }

  try {
    var engine = engines.myEngine();
    var source = engine && engine.getSource && engine.getSource();
    var sourcePath = source && source.toString && source.toString();
    if (sourcePath && sourcePath.indexOf("/") >= 0) {
      return files.dirname(sourcePath);
    }
  } catch (error2) {
  }

  for (var i = 0; i < candidates.length; i++) {
    if (files.exists(files.join(candidates[i], "config.js"))) {
      return candidates[i];
    }
  }

  return "/storage/emulated/0/脚本";
}

var SCRIPT_DIR = getScriptDir();

function localRequire(path) { return __require__(path); }

var config = localRequire("config.js");
config.runtime.scriptDir = SCRIPT_DIR;
if (config.output.useProjectDir) {
  config.output.baseDir = config.output.fixedBaseDir || files.join(SCRIPT_DIR, config.output.folderName || "datasource");
  config.output.cacheDir = files.join(config.output.baseDir, "候选记录");
  config.output.screenshotDir = files.join(config.output.baseDir, "截图");
  config.output.logDir = files.join(config.output.baseDir, "运行日志");
  config.output.xmlDir = files.join(config.output.baseDir, "页面XML");
}
var createLogger = localRequire("core/logger.js").createLogger;
var createPermissionManager = localRequire("core/permission.js").createPermissionManager;
var createStorage = localRequire("core/storage.js").createStorage;
var createUploader = localRequire("core/uploader.js").createUploader;
var createOcr = localRequire("core/ocr.js").createOcr;
var createMatcher = localRequire("core/matcher.js").createMatcher;
var createFloatyControl = localRequire("core/floaty-control.js").createFloatyControl;
var createDouyinAdapter = localRequire("platforms/douyin.js").createDouyinAdapter;

var logger = createLogger(config);
var permissions = createPermissionManager(config, logger);
var storage = createStorage(config, logger);
var uploader = createUploader(config, logger, storage);
var ocrEngine = createOcr(config, logger);
var matcher = createMatcher(config);
var floatyControl = createFloatyControl(config, logger);
var douyin = createDouyinAdapter(config, logger, ocrEngine);

var counters = {
  viewedCount: 0,
  liveViewedCount: 0,
  capturedCount: 0,
  recoverCount: 0,
  currentPhase: "",
  phaseStartedAt: "",
  phaseEndedAt: "",
  lastStopReason: ""
};

function randomStaySeconds() {
  var min = config.task.staySecondsMin;
  var max = config.task.staySecondsMax;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function isoNow() {
  return new Date().toISOString();
}

function containsRisk(text) {
  return config.runtime.riskWords.some(function (word) {
    return text && text.indexOf(word) >= 0;
  });
}

function waitWhilePaused() {
  while (floatyControl.state.paused && !floatyControl.state.stopRequested) {
    floatyControl.update({ lastMessage: "已暂停" });
    sleep(500);
  }
}

function pickLines(text) {
  return String(text || "")
    .split(/\n+/)
    .map(function (line) {
      return line.replace(/\s+/g, " ").trim();
    })
    .filter(function (line) {
      return line.length > 0;
    });
}

function uniqueLines(lines) {
  var seen = {};
  var result = [];
  lines.forEach(function (line) {
    if (!seen[line]) {
      seen[line] = true;
      result.push(line);
    }
  });
  return result;
}

function extractKeyInfo(screenData, hotComments) {
  var lines = uniqueLines(pickLines(screenData.combinedText));
  var metrics = lines.filter(function (line) {
    return /赞|评论|收藏|分享|万|w|W|在线|观看|人气/.test(line);
  });
  var possibleAuthors = lines.filter(function (line) {
    return /^@/.test(line) || /作者|农技|农业|种植|养殖/.test(line);
  });
  var titleLines = lines.filter(function (line) {
    return line.length >= 6 && line.length <= 80 && !/首页|朋友|消息|我|搜索|评论/.test(line);
  });

  return {
    titleText: titleLines.slice(0, 3).join(" / "),
    authorName: possibleAuthors[0] || "",
    metricsText: metrics.slice(0, 5).join(" / "),
    summaryText: titleLines.slice(0, 6).join("\n"),
    hotComments: hotComments || [],
    visibleLines: lines.slice(0, 80)
  };
}

function buildCandidate(screenData, matchResult, screenshotFiles, hotComments) {
  var keyInfo = extractKeyInfo(screenData, hotComments);
  return {
    taskId: config.task.taskId,
    deviceId: config.device.deviceId,
    platform: config.task.platform,
    sourceType: "mobile_agent",
    sceneType: screenData.sceneType || "video",
    keyword: config.task.mode === "search" ? config.task.keywords[0] : "",
    currentPhase: counters.currentPhase,
    viewedCount: counters.viewedCount,
    liveViewedCount: counters.liveViewedCount,
    capturedCount: counters.capturedCount,
    captureMode: config.task.captureMode,
    match: matchResult,
    screenText: screenData.combinedText,
    titleText: keyInfo.titleText,
    subtitleText: keyInfo.summaryText,
    authorName: keyInfo.authorName,
    metricsText: keyInfo.metricsText,
    hotComments: keyInfo.hotComments,
    visibleLines: keyInfo.visibleLines,
    screenshotFiles: [],
    capturedAt: isoNow(),
    rawText: screenData.ocrText,
    localOnly: !config.upload.enabled
  };
}

function collectCandidate(screenData, matchResult, options) {
  var hotComments = [];
  var collectComments = !options || options.collectComments !== false;

  if (collectComments && config.task.collectComments) {
    try {
      if (douyin.openComments()) {
        hotComments = douyin.extractHotComments(config.task.commentLimit);
        douyin.closeComments();
      }
    } catch (error) {
      logger.warn("评论采集失败", { message: String(error) });
      douyin.closeComments();
    }
  }

  var candidate = buildCandidate(screenData, matchResult, [], hotComments);
  storage.saveCandidate(candidate);
  var uploadResult = uploader.upload(candidate);

  counters.capturedCount += 1;
  floatyControl.update({
    capturedCount: counters.capturedCount,
    lastMessage: uploadResult.success ? "采集并上传成功" : "采集已缓存"
  });
}

function enterFlow() {
  if (!douyin.openApp()) {
    throw new Error("无法打开抖音");
  }

  if (config.task.mode === "search") {
    douyin.openSearch(config.task.keywords[0]);
  } else {
    douyin.enterVideoFeed();
  }
}

function shouldStop() {
  if (floatyControl.state.stopRequested) {
    counters.lastStopReason = "manual_stop";
    return true;
  }
  if (counters.viewedCount >= config.task.maxVideos) {
    counters.lastStopReason = "max_videos";
    return true;
  }
  if (counters.capturedCount >= config.task.maxCaptures) {
    counters.lastStopReason = "max_captures";
    return true;
  }
  return false;
}

function handleVideo(sceneType, phaseEndAt) {
  waitWhilePaused();
  if (shouldStop() || (phaseEndAt && Date.now() >= phaseEndAt)) {
    return;
  }

  var staySeconds = randomStaySeconds();
  floatyControl.update({
    viewedCount: counters.viewedCount,
    capturedCount: counters.capturedCount,
    lastMessage: "停留观察 " + staySeconds + " 秒"
  });
  sleep(staySeconds * 1000);

  floatyControl.compact("截图识别中");
  var screenData = douyin.extractScreen();
  floatyControl.expand("识别完成");
  screenData.sceneType = sceneType || "video";
  var text = screenData.combinedText || "";

  if (containsRisk(text)) {
    logger.error("检测到验证码、登录或风控提示，停止任务", { text: text });
    floatyControl.update({
      stopRequested: true,
      lastMessage: "检测到风险提示，已停止"
    });
    return;
  }

  var matchResult = matcher.evaluate(text);
  var manualCapture = floatyControl.consumeManualCapture();
  var captureAll = config.task.captureMode === "all";
  if (matchResult.matched || manualCapture || captureAll) {
    logger.info("命中候选内容", {
      manualCapture: manualCapture,
      captureAll: captureAll,
      match: matchResult
    });
    floatyControl.update({
      lastMessage: matchResult.matched ? "命中: " + matchResult.agricultureHits.join(",") : "调试采集"
    });
    collectCandidate(screenData, matchResult, {
      collectComments: screenData.sceneType === "video"
    });
  }

  if (screenData.sceneType === "live") {
    counters.liveViewedCount += 1;
  } else {
    counters.viewedCount += 1;
  }
  floatyControl.update({ viewedCount: counters.viewedCount });

  if (!shouldStop()) {
    if (floatyControl.consumeSkip()) {
      logger.info("处理悬浮窗跳过请求");
    }
    douyin.nextVideo();
  }
}

function runPhase(sceneType, durationMinutes) {
  counters.currentPhase = sceneType;
  counters.phaseStartedAt = isoNow();
  counters.phaseEndedAt = "";
  counters.lastStopReason = "";

  var endAt = Date.now() + durationMinutes * 60 * 1000;
  var startMs = Date.now();
  logger.info("开始采集阶段", {
    sceneType: sceneType,
    durationMinutes: durationMinutes,
    startedAt: counters.phaseStartedAt,
    expectedEndAt: new Date(endAt).toISOString()
  });
  floatyControl.update({
    lastMessage: (sceneType === "live" ? "直播阶段" : "视频阶段") + "开始"
  });

  if (sceneType === "live") {
    douyin.enterLiveFeed(config.task.keywords[0]);
  }

  while (!shouldStop() && Date.now() < endAt) {
    try {
      handleVideo(sceneType, endAt);
      counters.recoverCount = 0;
      sleep(config.runtime.loopIntervalMs);
    } catch (error) {
      logger.error("采集阶段异常", { sceneType: sceneType, message: String(error) });
      counters.recoverCount += 1;
      if (counters.recoverCount > config.runtime.recoverRetryCount) {
        logger.error("异常恢复次数超过上限，停止当前阶段");
        counters.lastStopReason = "recover_limit";
        break;
      }
      douyin.recover();
    }
  }

  if (!counters.lastStopReason) {
    counters.lastStopReason = Date.now() >= endAt ? "duration_finished" : "phase_finished";
  }
  counters.phaseEndedAt = isoNow();
  var elapsedMinutes = Math.round((Date.now() - startMs) / 60000);
  logger.info("采集阶段结束", {
    sceneType: sceneType,
    startedAt: counters.phaseStartedAt,
    endedAt: counters.phaseEndedAt,
    elapsedMinutes: elapsedMinutes,
    stopReason: counters.lastStopReason,
    viewedCount: counters.viewedCount,
    liveViewedCount: counters.liveViewedCount,
    capturedCount: counters.capturedCount
  });
  floatyControl.update({
    lastMessage: (sceneType === "live" ? "直播阶段" : "视频阶段") + "结束: " + counters.lastStopReason
  });
}

function main() {
  logger.info("农业视频手机采集脚本启动", {
    version: config.app.version,
    taskId: config.task.taskId,
    schedule: config.schedule,
    outputDir: config.output.baseDir
  });

  floatyControl.create();

  if (!permissions.ensureAll()) {
    logger.error("权限检查失败，脚本结束");
    return;
  }

  uploader.retryCached();

  toast("点击悬浮窗开始按钮启动采集");
  logger.info("等待悬浮窗开始指令");
  while (!floatyControl.state.running && !floatyControl.state.stopRequested) {
    sleep(500);
  }

  if (floatyControl.state.stopRequested) {
    logger.info("启动前收到停止指令");
    return;
  }

  enterFlow();

  if (config.schedule.enabled) {
    runPhase("video", config.schedule.videoMinutesPerDay);
    if (!floatyControl.state.stopRequested) {
      runPhase("live", config.schedule.liveMinutesPerDay);
    }
  } else {
    runPhase("video", 24 * 60);
  }

  floatyControl.update({
    running: false,
    paused: true,
    lastMessage: "任务结束"
  });
  logger.info("农业视频手机采集脚本结束", counters);
  toast("采集任务结束");
}

main();

