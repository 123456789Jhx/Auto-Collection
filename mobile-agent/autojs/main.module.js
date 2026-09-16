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
  if (bizScriptRuntime && bizScriptRuntime.state.source === "overlay" && /^(features|domain)\//.test(path)) {
    throw new Error("mixed business sources are forbidden in a validated overlay engine: " + path);
  }
  return requireWithModuleLoadLog("loadBaselineScript", path, files.join(SCRIPT_DIR, path), "baseline");
}

function localRequire(path) {
  var normalized = String(path || "").replace(/\\/g, "/");
  var business = /^(features|domain)\//.test(normalized);
  try {
    return requireWithModuleLoadLog("loadBizScript", path, bizScriptRuntime.resolve(normalized),
      business ? bizScriptRuntime.state.source : "baseline");
  } catch (error) {
    if (business) {
      try { bizScriptRuntime.markFailed(error); } catch (markError) {
        console.info("[WARN] biz_module_rejection_record_failed error=" + String(markError));
      }
    }
    throw error;
  }
}

var config = localBaselineRequire("config.js");
config.runtime.scriptDir = SCRIPT_DIR;
config.runtime.bizScriptRoot = BIZ_SCRIPT_ROOT;
var bizScriptRuntime = localBaselineRequire("app/biz-script-runtime.js").createBizScriptRuntime({
  scriptDir: SCRIPT_DIR,
  currentDir: BIZ_SCRIPT_CURRENT_DIR,
  deps: localBaselineRequire("app/biz-script-updater.js").createDefaultDeps(config)
});
config.runtime.bizScriptRuntimeState = bizScriptRuntime.state;
config.runtime.bizScriptsVersion = bizScriptRuntime.state.version;
if (typeof events !== "undefined" && events.on) events.on("exit", bizScriptRuntime.cleanup);

// 设备画像：按机型决定截图授权流程、输出目录候选、打开抖音后的等待区间等行为。
// 内置画像来自 device-profiles.js，服务端可在拉取任务配置后覆盖（见 control-loop.js）。
var deviceProfiles = localBaselineRequire("device-profiles.js");
var deviceProfile = deviceProfiles.resolveDeviceProfile({
  device: typeof device !== "undefined" ? device : null,
  config: config
});
config.deviceProfile.resolved = deviceProfile;
console.info("[INFO] device_profile_resolved " + JSON.stringify({
  key: deviceProfile.key,
  label: deviceProfile.label,
  matchedBy: deviceProfile.matchedBy,
  source: deviceProfile.source,
  model: typeof device !== "undefined" && device ? device.model : "",
  brand: typeof device !== "undefined" && device ? device.brand : "",
  sdkInt: typeof device !== "undefined" && device ? device.sdkInt : "",
  outputRoots: deviceProfile.values.outputRoots
}));

function ensureWritableDir(dirPath) {
  var stamp = new Date().getTime() + "-" + Math.floor(Math.random() * 1000000);
  var probePath = files.join(dirPath, ".write-probe-" + stamp);
  var payload = "probe-" + stamp;
  try {
    // createWithDirs 在失败时返回 false 而不抛异常，必须同时判断返回值
    if (files.createWithDirs(probePath) === false) {
      return false;
    }
  } catch (createError) {
    return false;
  }
  var writable = false;
  try {
    files.write(probePath, payload);
    writable = String(files.read(probePath)) === String(payload);
  } catch (writeError) {
    writable = false;
  }
  try {
    files.remove(probePath);
  } catch (removeError) {
  }
  return writable;
}

function resolveOutputBaseDir() {
  if (config.output.fixedBaseDir) {
    return config.output.fixedBaseDir;
  }
  var folderName = config.output.folderName || "datasource";
  // 候选顺序来自设备画像：不具备公共目录写权限的机型（如小米14 未授予
  // 「所有文件访问」）画像里 outputRoots 为空，直接使用脚本目录，避免逐个失败探测。
  var visibleRoots = deviceProfiles.pickOutputRoots(deviceProfile);
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

try {
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
var createNewCommentCommandBridge = localRequire("features/new-comment/command-bridge.js").createNewCommentCommandBridge;
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
var viewerCountParser = localRequire("domain/live-viewer-count.js");
var createPhaseRunner = localRequire("app/phase-runner.js").createPhaseRunner;
var createLiveCommentRunner = localRequire("features/live-comment/runner.js").createLiveCommentRunner;
var createCommerceCardLiveRunner = localRequire("features/commerce-card-live/runner.js").createCommerceCardLiveRunner;
var createCollectorApp = localRequire("app/collector-app.js").createCollectorApp;
var accessibility = localRequire("core/accessibility.js");

var logger = createLogger(config);
logger.info("业务脚本运行版本", bizScriptRuntime.state);
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
  runIdentityStorage: storages.create("AgriVideoCollectorActiveRun"),
  uploader: uploader,
  deviceRecoveryJournal: deviceRecoveryJournal,
  deviceRecoverySync: deviceRecoverySync,
  ocrEngine: ocrEngine,
  screenRecognizer: screenRecognizer,
  matcher: matcher,
  floatyControl: floatyControl,
  accessibility: accessibility,
  // 设备画像：feature 通过 context 读取，避免依赖 overlay 到基座文件的相对 require。
  deviceProfiles: deviceProfiles,
  deviceProfile: deviceProfile,
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
  riskDetector: riskDetector,
  viewerCountParser: viewerCountParser
};

context.bizScriptUpdater = createBizScriptUpdater(config, logger, uploader);
context.newCommentCommandBridge = createNewCommentCommandBridge(context);
context.newCommentCommandBridge.install();
context.accountWarmupCommandBridge = createAccountWarmupCommandBridge(context);
context.accountWarmupCommandBridge.install();
context.remoteWakeCommandBridge = createRemoteWakeCommandBridge(context);
context.remoteWakeCommandBridge.install();
context.newCommentCommandBridge.installPollMetadataPreserver();
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
} catch (startupError) {
  try { bizScriptRuntime.markFailed(startupError); } catch (markError) {
    console.info("[WARN] biz_startup_rejection_record_failed error=" + String(markError));
  }
  throw startupError;
}
try {
  app.main();
} catch (mainError) {
  // app.main() 抛出会直接终止引擎。这里显式记录，避免出现无法排查的"静默死亡"。
  try {
    if (context.logger && typeof context.logger.error === "function") {
      context.logger.error("Agent 主进程异常退出", { message: String(mainError) });
    } else {
      console.info("[ERROR] agent_main_aborted " + String(mainError));
    }
  } catch (logError) {
    try { console.info("[ERROR] agent_main_aborted " + String(mainError)); } catch (consoleError) {
    }
  }
  throw mainError;
}
