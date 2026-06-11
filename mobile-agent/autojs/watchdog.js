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
    if (cwd && files.exists(files.join(cwd, "main.js"))) {
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
    if (files.exists(files.join(candidates[i], "main.js"))) {
      return candidates[i];
    }
  }

  return "/storage/emulated/0/AgriVideoCollector";
}

function loadConfig(scriptDir) {
  try {
    return require(files.join(scriptDir, "config.js"));
  } catch (error) {
    return {
      app: { version: "0.0.0" },
      device: { deviceId: "unknown", deviceToken: "" },
      upload: {
        enabled: false,
        baseUrl: "http://106.54.41.106:18080/api/v1",
        timeoutMs: 10000,
        versionCheckEnabled: false,
        versionChannel: "stable"
      }
    };
  }
}

function ensureDeviceToken(config) {
  if (config.device && config.device.deviceToken) {
    return config.device.deviceToken;
  }
  try {
    var store = storages.create("AgriVideoCollectorDevice");
    var token = store.get("deviceToken", "");
    if (!token) {
      token = randomHex(64);
      store.put("deviceToken", token);
    }
    config.device = config.device || {};
    config.device.deviceToken = token;
    return token;
  } catch (error) {
    return "";
  }
}

function randomHex(length) {
  var chars = "0123456789abcdef";
  var value = "";
  for (var i = 0; i < length; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

function endpoint(config, path) {
  var baseUrl = config.upload && config.upload.baseUrl ? config.upload.baseUrl : "";
  return baseUrl.replace(/\/$/, "") + path;
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
  return sourceText.indexOf("/" + fileName) >= 0 || sourceText.indexOf("\\" + fileName) >= 0;
}

function mainEngines() {
  var result = [];
  try {
    var current = engines.myEngine();
    var all = engines.all();
    for (var i = 0; i < all.length; i++) {
      if (!isCurrentEngine(all[i], current) && isEngineFile(all[i], "main.js")) {
        result.push(all[i]);
      }
    }
  } catch (error) {
  }
  return result;
}

function isMainRunning() {
  return mainEngines().length > 0;
}

function stopMainEngines() {
  var list = mainEngines();
  for (var i = 0; i < list.length; i++) {
    try {
      list[i].forceStop();
    } catch (error) {
    }
  }
  if (list.length > 0) {
    sleep(2500);
  }
}

function getWatchdogStorage() {
  try {
    return storages.create("AgriVideoCollectorWatchdog");
  } catch (error) {
    return null;
  }
}

function readCurrentVersion(config) {
  return (config.app && config.app.version) || "0.0.0";
}

function requestHeaders(config) {
  return {
    "X-Device-Id": (config.device && config.device.deviceId) || "",
    "X-Device-Token": ensureDeviceToken(config)
  };
}

function checkVersion(config) {
  if (!config.upload || config.upload.enabled === false) {
    return null;
  }
  if (config.upload.versionCheckEnabled !== true) {
    return null;
  }
  var url =
    endpoint(config, "/mobile/agent-version") +
    "?deviceId=" +
    encodeURIComponent((config.device && config.device.deviceId) || "unknown") +
    "&currentVersion=" +
    encodeURIComponent(readCurrentVersion(config)) +
    "&channel=" +
    encodeURIComponent((config.upload && config.upload.versionChannel) || "stable");
  var response = http.get(url, {
    timeout: (config.upload && config.upload.timeoutMs) || 10000,
    headers: requestHeaders(config)
  });
  var body = response.body ? response.body.string() : "";
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error("version check failed: " + response.statusCode + " " + body);
  }
  return JSON.parse(body || "{}");
}

function uploadUpdateEvent(config, eventType, toVersion, message, payload) {
  try {
    http.postJson(endpoint(config, "/mobile/agent-update-events"), {
      deviceId: (config.device && config.device.deviceId) || "unknown",
      fromVersion: readCurrentVersion(config),
      toVersion: toVersion,
      eventType: eventType,
      message: message || "",
      payload: payload || {},
      reportedAt: new Date().toISOString()
    }, {
      timeout: (config.upload && config.upload.timeoutMs) || 10000,
      headers: requestHeaders(config)
    });
  } catch (error) {
    log("Agri watchdog update event failed: " + error);
  }
}

function ensureDir(path) {
  if (!files.exists(path)) {
    files.createWithDirs(files.join(path, ".keep"));
    files.remove(files.join(path, ".keep"));
  }
}

function javaFile(path) {
  return new java.io.File(String(path));
}

function isDirectory(path) {
  return javaFile(path).isDirectory();
}

function copyFile(source, target) {
  ensureDir(files.dirname(target));
  var input = new java.io.FileInputStream(source);
  var output = new java.io.FileOutputStream(target);
  var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
  try {
    var read;
    while ((read = input.read(buffer)) !== -1) {
      output.write(buffer, 0, read);
    }
  } finally {
    try {
      input.close();
    } catch (error) {
    }
    output.close();
  }
}

function deleteJavaPath(path) {
  var file = javaFile(path);
  if (!file.exists()) {
    return;
  }
  if (file.isDirectory()) {
    var children = file.listFiles();
    if (children) {
      for (var i = 0; i < children.length; i++) {
        deleteJavaPath(children[i].getAbsolutePath());
      }
    }
  }
  file.delete();
}

function copyDirRecursive(sourceDir, targetDir) {
  ensureDir(targetDir);
  var sourceFile = javaFile(sourceDir);
  var children = sourceFile.listFiles();
  if (!children) {
    return;
  }
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    var name = String(child.getName());
    var target = files.join(targetDir, name);
    if (child.isDirectory()) {
      copyDirRecursive(child.getAbsolutePath(), target);
    } else {
      copyFile(child.getAbsolutePath(), target);
    }
  }
}

function sha256File(path) {
  var md = java.security.MessageDigest.getInstance("SHA-256");
  var input = new java.io.FileInputStream(path);
  var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
  try {
    var read;
    while ((read = input.read(buffer)) !== -1) {
      md.update(buffer, 0, read);
    }
  } finally {
    input.close();
  }
  var bytes = md.digest();
  var hex = "";
  for (var i = 0; i < bytes.length; i++) {
    var value = bytes[i];
    if (value < 0) {
      value += 256;
    }
    if (value < 16) {
      hex += "0";
    }
    hex += value.toString(16);
  }
  return hex;
}

function downloadFile(config, url, targetPath) {
  var response = http.get(url, {
    timeout: 60000,
    headers: requestHeaders(config)
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error("download failed: " + response.statusCode);
  }
  var bytes = response.body.bytes();
  files.writeBytes(targetPath, bytes);
}

function deletePath(path) {
  try {
    deleteJavaPath(path);
  } catch (error) {
    try {
      files.remove(path);
    } catch (error2) {
    }
  }
}

function unzip(zipPath, targetDir) {
  ensureDir(targetDir);
  var zip = new java.util.zip.ZipInputStream(new java.io.FileInputStream(zipPath));
  var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
  try {
    var entry;
    while ((entry = zip.getNextEntry()) !== null) {
      var name = String(entry.getName());
      if (name.indexOf("..") >= 0 || name.indexOf(":") >= 0 || name.charAt(0) === "/") {
        throw new Error("unsafe zip entry: " + name);
      }
      var outPath = files.join(targetDir, name);
      if (entry.isDirectory()) {
        ensureDir(outPath);
      } else {
        ensureDir(files.dirname(outPath));
        var output = new java.io.FileOutputStream(outPath);
        try {
          var read;
          while ((read = zip.read(buffer)) !== -1) {
            output.write(buffer, 0, read);
          }
        } finally {
          output.close();
        }
      }
      zip.closeEntry();
    }
  } finally {
    zip.close();
  }
}

function findPackageRoot(stageDir, entryFile) {
  if (files.exists(files.join(stageDir, entryFile || "main.js"))) {
    return stageDir;
  }
  var children = files.listDir(stageDir) || [];
  for (var i = 0; i < children.length; i++) {
    var child = files.join(stageDir, children[i]);
    if (isDirectory(child) && files.exists(files.join(child, entryFile || "main.js"))) {
      return child;
    }
  }
  throw new Error("package entry not found: " + (entryFile || "main.js"));
}

function copyDirContents(sourceDir, targetDir) {
  var names = files.listDir(sourceDir) || [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var source = files.join(sourceDir, name);
    var target = files.join(targetDir, name);
    if (name === "datasource") {
      continue;
    }
    if (isDirectory(source)) {
      deletePath(target);
      copyDirRecursive(source, target);
    } else {
      copyFile(source, target);
    }
  }
}

function applyUpdate(config, versionInfo) {
  var latest = versionInfo && versionInfo.latestVersion;
  if (!latest || !latest.packageUrl) {
    return false;
  }
  var updateDir = files.join(SCRIPT_DIR, ".update");
  var zipPath = files.join(updateDir, "agent-" + latest.version + ".zip");
  var stageDir = files.join(updateDir, "stage-" + latest.version);
  ensureDir(updateDir);
  deletePath(stageDir);

  log("Agri watchdog downloading update: " + latest.packageUrl);
  downloadFile(config, latest.packageUrl, zipPath);
  uploadUpdateEvent(config, "DOWNLOADED", latest.version, "脚本包下载完成", { packageUrl: latest.packageUrl });

  if (latest.sha256) {
    var actualSha = sha256File(zipPath);
    if (String(actualSha).toLowerCase() !== String(latest.sha256).toLowerCase()) {
      throw new Error("sha256 mismatch: " + actualSha);
    }
  }
  uploadUpdateEvent(config, "VERIFIED", latest.version, "脚本包校验完成", { sha256: latest.sha256 || "" });

  unzip(zipPath, stageDir);
  var packageRoot = findPackageRoot(stageDir, latest.entryFile || "main.js");
  if (!files.exists(files.join(packageRoot, "main.js"))) {
    throw new Error("updated main.js not found");
  }

  stopMainEngines();
  copyDirContents(packageRoot, SCRIPT_DIR);
  uploadUpdateEvent(config, "APPLIED", latest.version, "脚本更新已应用", { entryFile: latest.entryFile || "main.js" });
  deletePath(stageDir);
  return true;
}

function maybeUpdate(force) {
  var now = Date.now();
  if (!force && watchdogStorage) {
    var lastCheckAt = Number(watchdogStorage.get("lastUpdateCheckAt", 0));
    if (lastCheckAt && now - lastCheckAt < UPDATE_CHECK_INTERVAL_MS) {
      return false;
    }
  }
  if (watchdogStorage) {
    watchdogStorage.put("lastUpdateCheckAt", now);
  }

  var config = loadConfig(SCRIPT_DIR);
  var result = checkVersion(config);
  if (!result || !result.updateAvailable) {
    return false;
  }

  var latestVersion = result.latestVersion ? result.latestVersion.version : "";
  uploadUpdateEvent(config, "CHECKED", latestVersion, "watchdog 发现新版本", result);
  try {
    var applied = applyUpdate(config, result);
    if (applied && watchdogStorage) {
      watchdogStorage.put("lastAppliedVersion", latestVersion);
    }
    return applied;
  } catch (error) {
    uploadUpdateEvent(config, "FAILED", latestVersion, String(error), result);
    throw error;
  }
}

var SCRIPT_DIR = getScriptDir();
var MAIN_PATH = files.join(SCRIPT_DIR, "main.js");
var CHECK_INTERVAL_MS = 60000;
var UPDATE_CHECK_INTERVAL_MS = 5 * 60000;
var WATCHDOG_LOCK_TTL_MS = 90000;
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
