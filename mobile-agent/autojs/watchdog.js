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
      files.exists(files.join(dir, "main.js")) &&
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
var MAIN_PATH = files.join(SCRIPT_DIR, "main.js");
var CHECK_INTERVAL_MS = 60000;
var UPDATE_CHECK_INTERVAL_MS = 2 * 60000;
var WATCHDOG_LOCK_TTL_MS = 90000;
var lastUpdateCheckAt = 0;

function getWatchdogStorage() {
  try {
    return storages.create("AgriVideoCollectorWatchdog");
  } catch (error) {
    log("Agri watchdog storage unavailable: " + error);
    return null;
  }
}

function engineSourceText(engine) {
  try {
    var source = engine && engine.getSource && engine.getSource();
    return source && source.toString ? source.toString() : "";
  } catch (error) {
    return "";
  }
}

function isCurrentEngine(engine, current) {
  if (!engine || !current) {
    return false;
  }
  try {
    if (engine === current) {
      return true;
    }
    if (engine.id !== undefined && current.id !== undefined && engine.id === current.id) {
      return true;
    }
  } catch (error) {
  }
  return false;
}

function isEngineFile(engine, fileName) {
  var sourceText = engineSourceText(engine);
  return sourceText === fileName ||
    sourceText.indexOf("/" + fileName) >= 0 ||
    sourceText.indexOf("\\" + fileName) >= 0;
}

function isMainRunning() {
  try {
    var current = engines.myEngine();
    var all = engines.all();
    for (var i = 0; i < all.length; i++) {
      if (!isCurrentEngine(all[i], current) && isEngineFile(all[i], "main.js")) {
        return true;
      }
    }
  } catch (error) {
    log("Agri watchdog cannot inspect engines: " + error);
  }
  return false;
}

function loadConfig() {
  var config = require(files.join(SCRIPT_DIR, "config.js"));
  config.runtime = config.runtime || {};
  config.runtime.scriptDir = SCRIPT_DIR;
  config.output = config.output || {};
  if (config.output.useProjectDir) {
    config.output.baseDir = config.output.fixedBaseDir || files.join(SCRIPT_DIR, config.output.folderName || "datasource");
    config.output.cacheDir = files.join(config.output.baseDir, "候选记录");
    config.output.screenshotDir = files.join(config.output.baseDir, "截图");
    config.output.logDir = files.join(config.output.baseDir, "运行日志");
    config.output.xmlDir = files.join(config.output.baseDir, "页面XML");
  }
  return config;
}

function maybeUpdate(force) {
  var config = loadConfig();
  if (!config.upload || !config.upload.enabled || !config.upload.versionCheckEnabled) {
    return false;
  }

  var now = Date.now();
  var intervalMs = Math.max(
    UPDATE_CHECK_INTERVAL_MS,
    Number(config.upload.versionCheckIntervalMinutes || 0) * 60 * 1000
  );
  if (!force && lastUpdateCheckAt && now - lastUpdateCheckAt < intervalMs) {
    return false;
  }
  lastUpdateCheckAt = now;

  var createLogger = require(files.join(SCRIPT_DIR, "core/logger.js")).createLogger;
  var createStorage = require(files.join(SCRIPT_DIR, "core/storage.js")).createStorage;
  var createUploader = require(files.join(SCRIPT_DIR, "core/uploader.js")).createUploader;
  var logger = createLogger(config);
  var storage = createStorage(config, logger);
  var uploader = createUploader(config, logger, storage);
  var versionResult = uploader.checkAgentVersion();

  if (!versionResult || !versionResult.updateAvailable || !versionResult.latestVersion) {
    return false;
  }

  log("Agri watchdog applies update: " + versionResult.latestVersion.version);
  var updateResult = uploader.applyAgentUpdate(versionResult, { scriptDir: SCRIPT_DIR });
  return !!(updateResult && updateResult.applied);
}

var watchdogStorage = getWatchdogStorage();
var missingMainNotified = false;

if (watchdogStorage) {
  var lastBeat = Number(watchdogStorage.get("lastBeat", 0));
  if (lastBeat && Date.now() - lastBeat < WATCHDOG_LOCK_TTL_MS) {
    log("Agri watchdog is already alive, skip duplicate start.");
    toast("watchdog已在运行");
    exit();
  }
  watchdogStorage.put("lastBeat", Date.now());
}

log("Agri watchdog started: " + SCRIPT_DIR);
toast("watchdog已启动");

while (true) {
  try {
    if (watchdogStorage) {
      watchdogStorage.put("lastBeat", Date.now());
    }

    try {
      if (maybeUpdate(false)) {
        MAIN_PATH = files.join(SCRIPT_DIR, "main.js");
        sleep(3000);
      }
    } catch (updateError) {
      log("Agri watchdog update failed: " + updateError);
    }

    if (!files.exists(MAIN_PATH)) {
      log("Agri watchdog cannot find main.js: " + MAIN_PATH);
      if (!missingMainNotified) {
        toast("找不到main.js，请导入完整脚本包");
        missingMainNotified = true;
      }
    } else if (!isMainRunning()) {
      log("Agri watchdog starts main.js");
      toast("watchdog启动main.js");
      engines.execScriptFile(MAIN_PATH);
      sleep(10000);
    } else {
      missingMainNotified = false;
    }
  } catch (error) {
    log("Agri watchdog error: " + error);
    toast("watchdog异常：" + error);
  }
  sleep(CHECK_INTERVAL_MS);
}
