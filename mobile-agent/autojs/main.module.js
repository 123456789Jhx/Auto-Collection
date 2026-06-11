"auto";

function getScriptDir() {
  var candidates = [
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

  return "/storage/emulated/0/AgriVideoCollector";
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
var createHeartbeatService = localRequire("app/heartbeat.js").createHeartbeatService;
var createControlLoop = localRequire("app/control-loop.js").createControlLoop;
var createCandidateService = localRequire("domain/candidate-service.js").createCandidateService;
var createLiveScorer = localRequire("domain/live-scorer.js").createLiveScorer;
var riskDetector = localRequire("domain/risk-detector.js");
var createPhaseRunner = localRequire("app/phase-runner.js").createPhaseRunner;
var createCollectorApp = localRequire("app/collector-app.js").createCollectorApp;

var logger = createLogger(config);
var permissions = createPermissionManager(config, logger);
var storage = createStorage(config, logger);
var uploader = createUploader(config, logger, storage);
var ocrEngine = createOcr(config, logger);
if (ocrEngine.setPermissionManager) {
  ocrEngine.setPermissionManager(permissions);
}
var matcher = createMatcher(config);
var floatyControl = createFloatyControl(config, logger);
var douyin = createDouyinAdapter(config, logger, ocrEngine, floatyControl);

var context = {
  config: config,
  logger: logger,
  permissions: permissions,
  storage: storage,
  uploader: uploader,
  ocrEngine: ocrEngine,
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

context.heartbeatService = createHeartbeatService(context);
context.controlLoop = createControlLoop(context);
context.candidateService = createCandidateService(context);
context.liveScorer = createLiveScorer(config);
context.phaseRunner = createPhaseRunner(context);

var app = createCollectorApp(context);
app.main();
