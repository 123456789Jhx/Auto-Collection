var policy = require("./biz-script-policy.js");
var compareBizVersions = policy.compareVersions;
var isValidBizVersion = policy.validVersion;
function getBizScriptCheckIntervalMs(upload) {
  upload = upload || {};
  if (upload.bizScriptHotReloadEnabled === true) {
    return Math.max(1000, Number(upload.bizScriptHotReloadIntervalSeconds || 5) * 1000);
  }
  return Math.max(1, Number(upload.bizScriptVersionCheckIntervalMinutes || 30)) * 60 * 1000;
}
function getBizScriptRetryIntervalMs(upload, checkIntervalMs) {
  var configured = Math.max(1, Number(upload && upload.bizScriptUpdateRetrySeconds || 60)) * 1000;
  return Math.min(checkIntervalMs, configured);
}
function joinPath() {
  return Array.prototype.slice.call(arguments).filter(Boolean).join("/").replace(/\/+/g, "/");
}
function decodeManifestPath(value) {
  var decoded = policy.safePath(value);
  if (decoded === "config.js" || !(decoded.indexOf("features/") === 0 || decoded.indexOf("domain/") === 0)) {
    throw new Error("manifest path outside business layers: " + decoded);
  }
  return decoded;
}
function validateManifest(manifest, expectedVersion) {
  if (!manifest || manifest.channel !== "biz-scripts") throw new Error("invalid biz-scripts manifest channel");
  if (String(manifest.version || "") !== String(expectedVersion || "")) throw new Error("manifest version mismatch");
  if (!manifest.files || Object.prototype.toString.call(manifest.files) !== "[object Array]" || !manifest.files.length) {
    throw new Error("manifest files are required");
  }
  var seen = {};
  return manifest.files.map(function (item) {
    if (!item || !/^[0-9a-f]{64}$/i.test(String(item.sha256 || ""))) throw new Error("invalid manifest sha256");
    var path = decodeManifestPath(item.path);
    if (seen[path]) throw new Error("duplicate manifest path: " + path);
    seen[path] = true;
    return { path: path, sha256: String(item.sha256).toLowerCase() };
  });
}
var partialHelpers = require("./biz-script-updater-partial.js");
function restartCurrentEngine(engineManager, exitFallback) {
  try {
    var engine = engineManager && engineManager.myEngine ? engineManager.myEngine() : null;
    if (engine && typeof engine.forceStop === "function") {
      engine.forceStop();
      return "force_stop";
    }
  } catch (error) {
  }
  if (typeof exitFallback === "function") {
    exitFallback();
    return "exit";
  }
  return "unavailable";
}
function createDefaultDeps(config) {
  function ensureDir(path) {
    if (!path) {
      console.log("[WARN] ensureDir 跳过：目录路径为空");
      return false;
    }
    try {
      if (files.exists(path)) {
        return true;
      }
      // createWithDirs 失败时可能返回 false，也可能抛异常，两者都必须兜住，
      // 否则未捕获异常会中断整个脚本引擎。
      if (files.createWithDirs(joinPath(path, ".keep")) === false) {
        console.log("[WARN] ensureDir 失败：" + path);
        return false;
      }
      files.remove(joinPath(path, ".keep"));
    } catch (error) {
      console.log("[WARN] ensureDir 失败：" + path + " -> " + error);
      return false;
    }
    return true;
  }

  function remove(path) {
    if (!files.exists(path)) return;
    try { files.removeDir(path); } catch (error) {
      try { files.remove(path); } catch (error2) {}
    }
  }

  function sha256File(path) {
    var digest = java.security.MessageDigest.getInstance("SHA-256");
    var input = new java.io.FileInputStream(path);
    var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
    try {
      var count = input.read(buffer);
      while (count > 0) {
        digest.update(buffer, 0, count);
        count = input.read(buffer);
      }
    } finally {
      input.close();
    }
    return digestHex(digest.digest());
  }

  function digestHex(bytes) {
    var hex = "";
    for (var i = 0; i < bytes.length; i++) {
      var value = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
      hex += (value < 16 ? "0" : "") + value.toString(16);
    }
    return hex;
  }

  function unzip(zipPath, targetDir) {
    ensureDir(targetDir);
    var input = new java.util.zip.ZipInputStream(new java.io.BufferedInputStream(new java.io.FileInputStream(zipPath)));
    var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
    try {
      var entry = input.getNextEntry();
      while (entry !== null) {
        var name = String(entry.getName() || "").replace(/\\/g, "/");
        if (!name || name.indexOf("..") >= 0 || name.charAt(0) === "/") throw new Error("unsafe zip entry: " + name);
        var outputPath = joinPath(targetDir, name);
        if (entry.isDirectory() || /\/$/.test(name)) {
          ensureDir(outputPath);
        } else {
          var parent = new java.io.File(outputPath).getParentFile();
          if (parent && !parent.exists()) parent.mkdirs();
          var output = new java.io.BufferedOutputStream(new java.io.FileOutputStream(outputPath));
          try {
            var count = input.read(buffer);
            while (count > 0) {
              output.write(buffer, 0, count);
              count = input.read(buffer);
            }
          } finally { output.close(); }
        }
        input.closeEntry();
        entry = input.getNextEntry();
      }
    } finally { input.close(); }
  }

  return {
    exists: function (path) { return files.exists(path); },
    ensureDir: ensureDir,
    remove: remove,
    copyFile: function (source, target) {
      var parent = new java.io.File(target).getParentFile();
      if (parent && !parent.exists()) parent.mkdirs();
      if (files.exists(target)) files.remove(target);
      if (!files.copy(source, target)) throw new Error("biz scripts file copy failed: " + source);
    },
    copyDir: function (source, target) { ensureDir(target); (files.listDir(source) || []).forEach(function (name) { var from = joinPath(source, name), to = joinPath(target, name); if (files.isDir(from)) this.copyDir(from, to); else this.copyFile(from, to); }, this); },
    renameDir: function (source, target) {
      if (files.exists(target)) throw new Error("biz scripts rename target exists: " + target);
      var targetFile = new java.io.File(target);
      var parent = targetFile.getParentFile();
      if (parent && !parent.exists()) parent.mkdirs();
      if (!new java.io.File(source).renameTo(targetFile)) {
        throw new Error("biz scripts directory rename failed: " + source + " -> " + target);
      }
    },
    readText: function (path) { return files.read(path); },
    writeText: function (path, value) { files.write(path, value); },
    sha256File: sha256File,
    sha256Text: function (text) {
      var digest = java.security.MessageDigest.getInstance("SHA-256");
      return digestHex(digest.digest(new java.lang.String(String(text)).getBytes("UTF-8")));
    },
    download: function (url, target) {
      var response = http.get(url, { timeout: Math.max(15000, Number(config.upload.timeoutMs || 5000) * 4) });
      if (response.statusCode < 200 || response.statusCode >= 300) throw new Error("biz scripts download failed: " + response.statusCode);
      var bytes = response.body.bytes();
      files.writeBytes(target, bytes);
      return bytes.length;
    },
    unzip: unzip,
    now: function () { return Date.now(); },
    restart: function () {
      return restartCurrentEngine(
        typeof engines !== "undefined" ? engines : null,
        typeof exit === "function" ? exit : null
      );
    }
  };
}
function createBizScriptUpdater(config, logger, uploader, dependencies) {
  var deps = dependencies || createDefaultDeps(config);
  var root = config.runtime.bizScriptRoot || joinPath(config.runtime.scriptDir, "biz-scripts");
  var currentDir = joinPath(root, "current");
  var backupRoot = joinPath(root, "backup");
  var workRoot = joinPath(root, "work");
  var nextCheckAt = 0;
  var checking = false;
  var baseline = null;
  try { baseline = policy.readBaseline(deps, config.runtime.scriptDir); } catch (baselineError) {
    logger.warn("APK业务脚本基线不可用，已禁用热更新", { message: String(baselineError) });
  }

  function report(eventType, fromVersion, toVersion, message, payload) {
    return uploader.uploadAgentUpdateEvent({
      eventType: eventType,
      fromVersion: fromVersion,
      toVersion: toVersion,
      message: message,
      payload: Object.assign({ channel: "biz-scripts" }, payload || {})
    });
  }

  function safeReport(eventType, fromVersion, toVersion, message, payload) {
    try { return report(eventType, fromVersion, toVersion, message, payload); } catch (error) {
      logger.warn("业务脚本更新事件上报失败", { eventType: eventType, message: String(error) });
      return null;
    }
  }

  function currentVersion() {
    try {
      var metadata = policy.validateOverlay(deps, currentDir, baseline);
      if (policy.isRejected(metadata, policy.readRejection(deps, root))) throw new Error("previously failed package");
      return metadata.version;
    } catch (error) { return baseline ? baseline.version : "0.0.0"; }
  }

  function isDeviceRegistrationReady() {
    var deviceId = String(config.device && config.device.deviceId || "").trim();
    return !!deviceId && (!uploader.isRegistered || uploader.isRegistered());
  }

  function queryBizScriptVersion(version) {
    var originalVersion = config.app.version;
    var originalChannel = config.upload.versionChannel;
    try {
      config.app.version = version;
      config.upload.versionChannel = "biz-scripts";
      return uploader.checkAgentVersion();
    } finally {
      config.app.version = originalVersion;
      config.upload.versionChannel = originalChannel;
    }
  }

  function applyVersion(versionResult) {
    if (!baseline) return { applied: false, disabled: true, message: "APK business baseline unavailable" };
    var latest = versionResult && versionResult.latestVersion;
    var fromVersion = currentVersion();
    if (!latest || latest.channel !== "biz-scripts" || !latest.packageUrl || !latest.version) {
      return { applied: false, rolledBack: false, message: "no biz-scripts update" };
    }
    if (!isValidBizVersion(latest.version)) {
      return { applied: false, rolledBack: false, message: "invalid biz-scripts version" };
    }
    var rejected = policy.readRejection(deps, root);
    if (rejected && rejected.baseCompatibilityId === baseline.baseCompatibilityId && rejected.version === latest.version) {
      return { applied: false, rolledBack: false, message: "biz scripts package previously failed to load" };
    }
    if (compareBizVersions(latest.version, fromVersion) <= 0) {
      return { applied: false, rolledBack: false, message: "biz-scripts version is not newer" };
    }
    if (!/^[0-9a-f]{64}$/i.test(String(latest.sha256 || ""))) {
      return { applied: false, rolledBack: false, message: "invalid biz-scripts package sha256" };
    }
    var manifestEntry = String(latest.entryFile || "biz-script-manifest.json");
    if (!/^[A-Za-z0-9._-]+$/.test(manifestEntry) || manifestEntry.indexOf("..") >= 0) {
      return { applied: false, rolledBack: false, message: "invalid biz-scripts manifest entry" };
    }
    var workDir = joinPath(workRoot, "work-" + latest.version + "-" + deps.now());
    var zipPath = joinPath(workDir, "package.zip");
    var extractDir = joinPath(workDir, "extract");
    var nextDir = joinPath(workDir, "next");
    var backupDir = joinPath(backupRoot, fromVersion + "-" + deps.now());
    var activationStarted = false;
    var activated = false;
    var rolledBack = false;
    try {
      deps.ensureDir(workDir);
      var size = deps.download(latest.packageUrl, zipPath);
      var packageSha = deps.sha256File(zipPath).toLowerCase();
      if (packageSha !== String(latest.sha256).toLowerCase()) throw new Error("biz scripts package sha256 mismatch");
      safeReport("DOWNLOADED", fromVersion, latest.version, "biz scripts downloaded", { sha256: packageSha, sizeBytes: size });
      deps.unzip(zipPath, extractDir);
      var manifestPath = joinPath(extractDir, manifestEntry);
      var manifest = JSON.parse(deps.readText(manifestPath));
      var manifestFiles = validateManifest(manifest, latest.version);
      policy.assertCompatible(manifest, baseline, deps);
      var partial = manifest.mode === "partial";
      if (manifest.mode && manifest.mode !== "partial" && manifest.mode !== "full") {
        throw new Error("invalid biz scripts manifest mode");
      }
      var deltaFiles = [];
      if (partial) {
        if (!manifest.baseVersion || Object.prototype.toString.call(manifest.deltaFiles) !== "[object Array]" || !manifest.deltaFiles.length) {
          throw new Error("partial biz scripts manifest metadata is incomplete");
        }
        if (latest.baseVersion && String(latest.baseVersion) !== String(manifest.baseVersion)) {
          throw new Error("biz scripts baseVersion metadata mismatch");
        }
        deltaFiles = validateManifest({ channel: "biz-scripts", version: latest.version, files: manifest.deltaFiles }, latest.version);
        var deltaPaths = deltaFiles.map(function (file) { return file.path; }).sort();
        var mergedPaths = manifestFiles.map(function (file) { return file.path; }).sort();
        if (deltaPaths.some(function (path) { return mergedPaths.indexOf(path) < 0; })) {
          throw new Error("partial biz scripts delta file is absent from merged manifest");
        }
        policy.validateOverlay(deps, currentDir, baseline);
        partialHelpers.assertPartialBase(partialHelpers.validateCurrentState(deps, currentDir, validateManifest), manifest, deltaFiles);
      }
      for (var i = 0; i < manifestFiles.length; i++) {
        var file = manifestFiles[i];
        if (partial && !deltaFiles.some(function (delta) { return delta.path === file.path; })) continue;
        var actual = deps.sha256File(joinPath(extractDir, file.path)).toLowerCase();
        if (actual !== file.sha256) throw new Error("biz scripts file sha256 mismatch: " + file.path);
      }
      safeReport("VERIFIED", fromVersion, latest.version, "biz scripts verified", {
        mode: partial ? "partial" : "full", fileCount: partial ? deltaFiles.length : manifestFiles.length,
        files: (partial ? deltaFiles : manifestFiles).map(function (file) { return file.path; })
      });
      deps.ensureDir(nextDir);
      if (partial) {
        if (typeof deps.copyDir !== "function") throw new Error("biz scripts partial update requires directory copy support");
        deps.copyDir(currentDir, nextDir);
      }
      var filesToApply = partial ? deltaFiles : manifestFiles;
      for (var j = 0; j < filesToApply.length; j++) {
        deps.copyFile(joinPath(extractDir, filesToApply[j].path), joinPath(nextDir, filesToApply[j].path));
      }
      deps.writeText(joinPath(nextDir, "version.json"), JSON.stringify({
        schemaVersion: 2,
        baseCompatibilityId: manifest.baseCompatibilityId,
        sourceSha256: manifest.sourceSha256,
        version: latest.version,
        channel: "biz-scripts",
        mode: partial ? "partial" : "full",
        files: manifestFiles
      }));
      policy.validateOverlay(deps, nextDir, baseline);
      if (deps.exists(currentDir)) {
        deps.remove(backupDir);
        deps.renameDir(currentDir, backupDir);
        activationStarted = true;
      }
      deps.renameDir(nextDir, currentDir);
      activated = true;
    } catch (error) {
      if (activationStarted && !activated && deps.exists(backupDir)) {
        try {
          deps.remove(currentDir);
          deps.renameDir(backupDir, currentDir);
          rolledBack = true;
        } catch (rollbackError) {
          logger.warn("业务脚本回滚失败", { message: String(rollbackError), backupDir: backupDir });
        }
      }
      deps.remove(workDir);
      safeReport("FAILED", fromVersion, latest.version, String(error), {});
      if (rolledBack) safeReport("ROLLBACK", latest.version, fromVersion, "biz scripts rollback completed", {});
      logger.warn("业务脚本热更新失败", { message: String(error), rolledBack: rolledBack });
      return { applied: false, rolledBack: rolledBack, message: String(error) };
    }

    deps.remove(workDir);
    config.runtime.pendingBizScriptsVersion = latest.version;
    var appliedFiles = manifest.mode === "partial" ? manifest.deltaFiles : manifest.files;
    safeReport("APPLIED", fromVersion, latest.version, "biz scripts applied", {
      restartPending: true, runningVersion: config.runtime.bizScriptsVersion,
      mode: manifest.mode === "partial" ? "partial" : "full",
      fileCount: appliedFiles.length,
      files: appliedFiles.map(function (file) { return file.path; })
    });
    logger.info("业务脚本已暂存，等待引擎重启加载", {
      fromVersion: fromVersion, toVersion: latest.version,
      mode: manifest.mode === "partial" ? "partial" : "full",
      fileCount: appliedFiles.length,
      files: appliedFiles.map(function (file) { return file.path; })
    });
    try {
      var restartResult = deps.restart();
      if (restartResult === "unavailable" || restartResult === false) throw new Error("engine restart unavailable");
    } catch (restartError) {
      safeReport("FAILED", config.runtime.bizScriptsVersion, latest.version, String(restartError), {
        phase: "restart", restartPending: true, runningVersion: config.runtime.bizScriptsVersion
      });
      logger.warn("业务脚本尚未加载新版本，自动重启失败", { message: String(restartError), pendingVersion: latest.version });
      return { applied: true, rolledBack: false, version: latest.version, restartFailed: true };
    }
    return { applied: true, rolledBack: false, version: latest.version };
  }

  function check(force) {
    if (config.upload.bizScriptVersionCheckEnabled === false) return { checked: false, disabled: true };
    if (!baseline) return { checked: false, disabled: true, reason: "apk_baseline_unavailable" };
    if (!isDeviceRegistrationReady()) {
      return { checked: false, deferred: true, reason: "device_not_registered" };
    }
    var interval = getBizScriptCheckIntervalMs(config.upload);
    var now = deps.now();
    if (checking) return { checked: false, skipped: true, reason: "check_in_progress" };
    if (!force && now < nextCheckAt) return { checked: false, skipped: true };
    nextCheckAt = now + interval;
    checking = true;
    var version = currentVersion();
    try {
      var result = queryBizScriptVersion(version);
      if (!result) {
        nextCheckAt = now + getBizScriptRetryIntervalMs(config.upload, interval);
        return { checked: true, updateAvailable: false };
      }
      safeReport("CHECKED", version, result.latestVersion && result.latestVersion.version, "biz scripts version checked", {
        updateAvailable: !!result.updateAvailable
      });
      if (result.updateAvailable && result.latestVersion) {
        var applied = applyVersion(result);
        if (!applied.applied) nextCheckAt = now + getBizScriptRetryIntervalMs(config.upload, interval);
        return applied;
      }
      return { checked: true, updateAvailable: false, version: version };
    } catch (error) {
      nextCheckAt = now + getBizScriptRetryIntervalMs(config.upload, interval);
      throw error;
    } finally {
      checking = false;
    }
  }

  config.runtime.bizScriptsVersion = config.runtime.bizScriptRuntimeState ?
    config.runtime.bizScriptRuntimeState.version : currentVersion();
  return { check: check, applyVersion: applyVersion, currentVersion: currentVersion };
}

module.exports = {
  compareBizVersions: compareBizVersions,
  createBizScriptUpdater: createBizScriptUpdater,
  createDefaultDeps: createDefaultDeps,
  restartCurrentEngine: restartCurrentEngine,
  validateManifest: validateManifest
};
