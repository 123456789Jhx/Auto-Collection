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

  try {
    var cwd = files.cwd();
    if (cwd && files.exists(files.join(cwd, "p0-live-readonly.js"))) {
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
    if (files.exists(files.join(candidates[i], "p0-live-readonly.js"))) {
      return candidates[i];
    }
  }

  return "/storage/emulated/0/燎原星火";
}

var SCRIPT_DIR = getScriptDir();

function localRequire(path) {
  return require(files.join(SCRIPT_DIR, path));
}

var config = localRequire("config.js");
config.runtime.scriptDir = SCRIPT_DIR;
if (config.output.useProjectDir) {
  config.output.fixedBaseDir = files.join(SCRIPT_DIR, config.output.folderName || "datasource");
  config.output.baseDir = config.output.fixedBaseDir;
  config.output.cacheDir = files.join(config.output.baseDir, "候选记录");
  config.output.screenshotDir = files.join(config.output.baseDir, "截图");
  config.output.logDir = files.join(config.output.baseDir, "运行日志");
  config.output.xmlDir = files.join(config.output.baseDir, "页面XML");
}

var createLogger = localRequire("core/logger.js").createLogger;
var createDouyinAdapter = localRequire("platforms/douyin/adapter.js").createDouyinAdapter;
var createLiveRoomDetector = localRequire("domain/live-room-detector.js").createLiveRoomDetector;
var createLiveCommentReader = localRequire("domain/live-comment-reader.js").createLiveCommentReader;
var createLiveCommentReadonlyProbe = localRequire("domain/live-comment-readonly-probe.js").createLiveCommentReadonlyProbe;
var createCommentCache = localRequire("domain/comment-cache.js").createCommentCache;
var createTriggerDetector = localRequire("domain/trigger-detector.js").createTriggerDetector;
var createCommentActionPlanner = localRequire("domain/comment-action-planner.js").createCommentActionPlanner;
var createStorage = localRequire("core/storage.js").createStorage;

var logger = createLogger(config);
var storage = createStorage(config, logger);
var ocrStub = {
  captureRegions: function () {
    return {
      image: null,
      text: "",
      regions: {}
    };
  }
};
var douyin = createDouyinAdapter(config, logger, ocrStub, null);
var detector = createLiveRoomDetector({
  expectedPackage: "com.ss.android.ugc.aweme"
});
var reader = createLiveCommentReader({
  maxLines: 80
});
var liveCommentConfig = config.task.liveComment || {};
var commentCache = createCommentCache({
  maxSize: liveCommentConfig.localCommentCacheSize
});
var triggerDetector = createTriggerDetector({
  leaderAccountNames: liveCommentConfig.leaderAccountNames,
  leaderAccountIds: liveCommentConfig.leaderAccountIds,
  triggerKeywords: liveCommentConfig.triggerKeywords
});
var actionPlanner = createCommentActionPlanner(liveCommentConfig);
var probe = createLiveCommentReadonlyProbe({
  config: config,
  logger: logger,
  douyin: douyin,
  detector: detector,
  reader: reader,
  commentCache: commentCache,
  triggerDetector: triggerDetector,
  actionPlanner: actionPlanner,
  storage: storage
});

probe.run({
      maxSamples: 20,
      sampleIntervalMs: 1200,
      tryEnterLiveRoom: true,
      externalLaunchWaitMs: 20000,
      maxForegroundRecoveries: 2,
      maxLiveEntryAttempts: 2
    });
