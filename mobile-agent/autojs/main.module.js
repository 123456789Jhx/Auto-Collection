function getScriptDir() {
  var candidates = [
    "/storage/emulated/0/燎原星火",
    "/sdcard/燎原星火",
    "/storage/emulated/0/Download/燎原星火",
    "/sdcard/Download/燎原星火",
    "/storage/emulated/0/AgriVideoCollector",
    "/sdcard/AgriVideoCollector",
    "/storage/emulated/0/Download/AgriVideoCollector",
    "/sdcard/Download/AgriVideoCollector"
  ];

  function hasRequiredFiles(dir) {
    return dir &&
      files.exists(files.join(dir, "config.js")) &&
      files.exists(files.join(dir, "core/accessibility.js"));
  }

  try {
    var cwd = files.cwd();
    if (hasRequiredFiles(cwd)) {
      return cwd;
    }
  } catch (error) {
  }

  try {
    var engine = engines.myEngine();
    var source = engine && engine.getSource && engine.getSource();
    var sourcePath = source && source.toString && source.toString();
    if (sourcePath && sourcePath.indexOf("/") >= 0) {
      var sourceDir = files.dirname(sourcePath);
      if (hasRequiredFiles(sourceDir)) {
        return sourceDir;
      }
    }
  } catch (error2) {
  }

  for (var i = 0; i < candidates.length; i++) {
    if (hasRequiredFiles(candidates[i])) {
      return candidates[i];
    }
  }

  return "/storage/emulated/0/燎原星火";
}
var SCRIPT_DIR = getScriptDir();
var BIZ_SCRIPT_ROOT = files.join(SCRIPT_DIR, "biz-scripts");
var BIZ_SCRIPT_CURRENT_DIR = files.join(BIZ_SCRIPT_ROOT, "current");

function requireWithModuleLoadLog(loaderName, path, resolvedPath, source) {
  var startedAt = new Date().getTime();
  console.info("[INFO] biz_module_load_start loader=" + loaderName + " source=" + source + " modulePath=" + path);
  try {
    var loadedModule = require(resolvedPath);
    console.info("[INFO] biz_module_load_finish loader=" + loaderName + " source=" + source + " modulePath=" + path + " elapsedMs=" + (new Date().getTime() - startedAt) + " success=true");
    return loadedModule;
  } catch (error) {
    console.info("[INFO] biz_module_load_finish loader=" + loaderName + " source=" + source + " modulePath=" + path + " elapsedMs=" + (new Date().getTime() - startedAt) + " success=false error=" + String(error));
    throw error;
  }
}

function localBaselineRequire(path) {
  return requireWithModuleLoadLog("loadBaselineScript", path, files.join(SCRIPT_DIR, path), "baseline");
}

function localRequire(path) {
  var normalized = String(path || "").replace(/\\/g, "/");
  if (normalized.indexOf("features/") === 0 || normalized.indexOf("domain/") === 0) {
    var overridePath = files.join(BIZ_SCRIPT_CURRENT_DIR, normalized);
    if (files.exists(overridePath)) {
      return requireWithModuleLoadLog("loadBizScript", path, overridePath, "overlay");
    }
  }
  return requireWithModuleLoadLog("loadBizScript", path, files.join(SCRIPT_DIR, path), "baseline");
}

var config = localRequire("config.js");
config.runtime.scriptDir = SCRIPT_DIR;
config.runtime.bizScriptRoot = BIZ_SCRIPT_ROOT;

function ensureWritableDir(dirPath) {
  try {
    files.createWithDirs(files.join(dirPath, ".write-test"));
    files.remove(files.join(dirPath, ".write-test"));
    return true;
  } catch (error) {
    return false;
  }
}

function resolveOutputBaseDir() {
  if (config.output.fixedBaseDir) {
    return config.output.fixedBaseDir;
  }
  var folderName = config.output.folderName || "datasource";
  var visibleRoots = [
    "/storage/emulated/0/燎原星火",
    "/sdcard/燎原星火",
    "/storage/emulated/0/Download/燎原星火",
    "/sdcard/Download/燎原星火",
    "/storage/emulated/0/AgriVideoCollector",
    "/sdcard/AgriVideoCollector"
  ];
  for (var i = 0; i < visibleRoots.length; i++) {
    var visibleBaseDir = files.join(visibleRoots[i], folderName);
    if (ensureWritableDir(visibleBaseDir)) {
      return visibleBaseDir;
    }
  }
  return files.join(SCRIPT_DIR, folderName);
}

if (config.output.useProjectDir) {
  config.output.baseDir = resolveOutputBaseDir();
  config.output.cacheDir = files.join(config.output.baseDir, "候选记录");
  config.output.screenshotDir = files.join(config.output.baseDir, "截图");
  config.output.logDir = files.join(config.output.baseDir, "运行日志");
  config.output.xmlDir = files.join(config.output.baseDir, "页面XML");
}

var createLogger = localRequire("core/logger.js").createLogger;
var createPermissionManager = localRequire("core/permission.js").createPermissionManager;
var createStorage = localRequire("core/storage.js").createStorage;
var createUploader = localRequire("core/uploader.js").createUploader;
var createDeviceRecoveryJournal = localBaselineRequire("app/device-recovery-journal.js").createDeviceRecoveryJournal;
var createDeviceRecoverySync = localBaselineRequire("app/device-recovery-sync.js").createDeviceRecoverySync;
var createOcr = localRequire("core/ocr.js").createOcr;
var createScreenRecognizer = localRequire("core/screen-recognizer.js").createScreenRecognizer;
var createMatcher = localRequire("core/matcher.js").createMatcher;
var createFloatyControl = localRequire("core/floaty-control.js").createFloatyControl;
var createDouyinAdapter = localRequire("platforms/douyin/adapter.js").createDouyinAdapter;
var createHeartbeatService = localRequire("app/heartbeat.js").createHeartbeatService;
var createBizScriptUpdater = localRequire("app/biz-script-updater.js").createBizScriptUpdater;
var createAgentHeartbeatDaemon = localRequire("app/agent-heartbeat-daemon.js").createAgentHeartbeatDaemon;
var createControlLoop = localRequire("app/control-loop.js").createControlLoop;
var createAccountWarmupCommandBridge = localRequire("app/account-warmup-command-bridge.js").createAccountWarmupCommandBridge;
var createRemoteWakeCommandBridge = localRequire("app/remote-wake-command-bridge.js").createRemoteWakeCommandBridge;
var createTaskScheduler = localRequire("app/task-scheduler.js").createTaskScheduler;
var createRunRequestResolver = localRequire("app/run-request-resolver.js").createRunRequestResolver;
var createCandidateService = localRequire("domain/candidate-service.js").createCandidateService;
var createLiveScorer = localRequire("domain/live-scorer.js").createLiveScorer;
var createLiveRoomDetector = localRequire("domain/live-room-detector.js").createLiveRoomDetector;
var createLiveRoomRelevanceDetector = localRequire("domain/live-room-relevance-detector.js").createLiveRoomRelevanceDetector;
var createLiveCommentReader = localRequire("domain/live-comment-reader.js").createLiveCommentReader;
var createLiveCommentClassifier = localRequire("domain/live-comment-classifier.js").createLiveCommentClassifier;
var createCommentSafetyFilter = localRequire("domain/comment-safety-filter.js").createCommentSafetyFilter;
var createAgriCommentBotPlanner = localRequire("domain/agri-comment-bot-planner.js").createAgriCommentBotPlanner;
var createLiveRoomSampler = localRequire("domain/live-room-sampler.js").createLiveRoomSampler;
var createCommentCache = localRequire("domain/comment-cache.js").createCommentCache;
var createTriggerDetector = localRequire("domain/trigger-detector.js").createTriggerDetector;
var createCommentActionPlanner = localRequire("domain/comment-action-planner.js").createCommentActionPlanner;
var createP3ExtensionActions = localRequire("domain/p3-extension-actions.js").createP3ExtensionActions;
var liveTargetMatcher = localRequire("domain/live-target-matcher.js");
var riskDetector = localRequire("domain/risk-detector.js");
var createPhaseRunner = localRequire("app/phase-runner.js").createPhaseRunner;
var createLiveCommentRunner = localRequire("features/live-comment/runner.js").createLiveCommentRunner;
var createCommerceCardLiveRunner = localRequire("features/commerce-card-live/runner.js").createCommerceCardLiveRunner;
var createCollectorApp = localRequire("app/collector-app.js").createCollectorApp;

var logger = createLogger(config);
var permissions = createPermissionManager(config, logger);
var storage = createStorage(config, logger);
var uploader = createUploader(config, logger, storage);
var deviceRecoveryJournal = createDeviceRecoveryJournal();
var deviceRecoverySync = createDeviceRecoverySync({
  journal: deviceRecoveryJournal,
  deviceId: function () { return config.device.deviceId || ""; },
  send: function (payload) { return uploader.uploadDeviceRecoveryStage(payload); },
  retryIntervalMs: 30000
});
deviceRecoveryJournal.recordStage("AGENT_LAUNCHED", { entry: "main.module.js" });
var ocrEngine = createOcr(config, logger);
if (ocrEngine.setPermissionManager) {
  ocrEngine.setPermissionManager(permissions);
}
var matcher = createMatcher(config);
var floatyControl = createFloatyControl(config, logger);
var screenRecognizer = createScreenRecognizer(config, logger, ocrEngine, { expectedPackage: "com.ss.android.ugc.aweme" });
var douyin = createDouyinAdapter(config, logger, ocrEngine, floatyControl, screenRecognizer, liveTargetMatcher);

var context = {
  config: config,
  loadBizScript: localRequire,
  loadBaselineScript: localBaselineRequire,
  logger: logger,
  permissions: permissions,
  storage: storage,
  uploader: uploader,
  deviceRecoveryJournal: deviceRecoveryJournal,
  deviceRecoverySync: deviceRecoverySync,
  ocrEngine: ocrEngine,
  screenRecognizer: screenRecognizer,
  matcher: matcher,
  floatyControl: floatyControl,
  douyin: douyin,
  counters: {
    viewedCount: 0,
    liveViewedCount: 0,
    liveRoomEnteredCount: 0,
    liveCandidateCount: 0,
    liveRejectedCount: 0,
    capturedCount: 0,
    recoverCount: 0,
    invalidContextCount: 0,
    currentPhase: "",
    phaseStartedAt: "",
    phaseEndedAt: "",
    lastStopReason: "",
    plannedVideoMinutes: 0,
    plannedLiveMinutes: 0,
    videoElapsedMinutes: 0,
    videoRemainingMinutes: null,
    liveElapsedMinutes: 0,
    liveRemainingMinutes: null
  },
  heartbeat: {
    lastAt: 0,
    agentLastAt: 0
  },
  commandControl: {
    lastPollAt: 0,
    polling: false
  },
  agentVersion: {
    lastCheckAt: 0,
    lastResult: null
  },
  livePhaseState: {
    maxRoomsLogged: false
  },
  riskDetector: riskDetector
};

context.bizScriptUpdater = createBizScriptUpdater(config, logger, uploader);
context.accountWarmupCommandBridge = createAccountWarmupCommandBridge(context);
context.accountWarmupCommandBridge.install();
context.remoteWakeCommandBridge = createRemoteWakeCommandBridge(context);
context.remoteWakeCommandBridge.install();
context.heartbeatService = createHeartbeatService(context);
context.agentHeartbeatDaemon = createAgentHeartbeatDaemon(context);
context.taskScheduler = createTaskScheduler(context);
context.runRequestResolver = createRunRequestResolver(context);
context.controlLoop = createControlLoop(context);
context.candidateService = createCandidateService(context);
context.liveScorer = createLiveScorer(config);
context.liveRoomDetector = createLiveRoomDetector({ expectedPackage: "com.ss.android.ugc.aweme" });
context.liveRoomRelevanceDetector = createLiveRoomRelevanceDetector({
  baseKeywords: config.match && config.match.agricultureKeywords || [],
  negativeKeywords: ["娱乐", "游戏", "明星", "八卦", "招商", "卖课", "私信", "加微信", "代理", "加盟"]
});
context.liveCommentReader = createLiveCommentReader({ maxLines: config.task.liveReadonlyMaxComments || 30 });
context.liveCommentClassifier = createLiveCommentClassifier();
context.liveCommentCache = createCommentCache({
  maxSize: config.task.liveComment && config.task.liveComment.localCommentCacheSize
});
context.commentSafetyFilter = createCommentSafetyFilter({
  bannedWords: ["私信", "加微信", "微信", "联系方式", "招商", "加盟", "卖课", "代理"]
});
context.agriCommentBotPlanner = createAgriCommentBotPlanner({
  safetyFilter: context.commentSafetyFilter
});
context.liveTriggerDetector = createTriggerDetector({
  leaderAccountNames: config.task.liveComment && config.task.liveComment.leaderAccountNames,
  leaderAccountIds: config.task.liveComment && config.task.liveComment.leaderAccountIds,
  triggerKeywords: config.task.liveComment && config.task.liveComment.triggerKeywords
});
context.liveCommentActionPlanner = createCommentActionPlanner(config.task.liveComment || {});
context.p3ExtensionActions = createP3ExtensionActions(context);
context.liveRoomSampler = createLiveRoomSampler(context);
context.phaseRunner = createPhaseRunner(context);
context.liveCommentRunner = createLiveCommentRunner(context);
context.commerceCardLiveRunner = createCommerceCardLiveRunner(context);

var app = createCollectorApp(context);
app.main();
