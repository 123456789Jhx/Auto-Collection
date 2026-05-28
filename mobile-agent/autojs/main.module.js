"auto";

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

function localRequire(path) {
  return require(files.join(SCRIPT_DIR, path));
}

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
