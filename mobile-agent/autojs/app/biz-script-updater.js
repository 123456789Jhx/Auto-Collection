function compareBizVersions(left, right) {
  var leftParts = String(left || "0").split(".").map(function (item) { return Number(item) || 0; });
  var rightParts = String(right || "0").split(".").map(function (item) { return Number(item) || 0; });
  var length = Math.max(leftParts.length, rightParts.length);
  for (var i = 0; i < length; i++) {
    var diff = (leftParts[i] || 0) - (rightParts[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function joinPath() {
  return Array.prototype.slice.call(arguments).filter(Boolean).join("/").replace(/\/+/g, "/");
}

function decodeManifestPath(value) {
  var decoded = decodeURIComponent(String(value || "")).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!decoded || decoded.indexOf("..") >= 0) throw new Error("unsafe manifest path: " + decoded);
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
  return manifest.files.map(function (item) {
    if (!item || !/^[0-9a-f]{64}$/i.test(String(item.sha256 || ""))) throw new Error("invalid manifest sha256");
    return { path: decodeManifestPath(item.path), sha256: String(item.sha256).toLowerCase() };
  });
}

function createDefaultDeps(config) {
  function ensureDir(path) {
    if (!files.exists(path)) {
      files.createWithDirs(joinPath(path, ".keep"));
      files.remove(joinPath(path, ".keep"));
    }
  }

  function remove(path) {
    if (!files.exists(path)) return;
    try { files.removeDir(path); } catch (error) {
      try { files.remove(path); } catch (error2) {}
    }
  }

  function copyDir(source, target) {
    ensureDir(target);
    var names = files.listDir(source) || [];
    for (var i = 0; i < names.length; i++) {
      var sourcePath = joinPath(source, names[i]);
      var targetPath = joinPath(target, names[i]);
      var sourceFile = new java.io.File(sourcePath);
      if (sourceFile.isDirectory()) {
        copyDir(sourcePath, targetPath);
      } else {
        var parent = new java.io.File(targetPath).getParentFile();
        if (parent && !parent.exists()) parent.mkdirs();
        if (files.exists(targetPath)) files.remove(targetPath);
        files.copy(sourcePath, targetPath);
      }
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
    var bytes = digest.digest();
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
    copyDir: copyDir,
    moveDir: function (source, target) { remove(target); copyDir(source, target); remove(source); },
    readText: function (path) { return files.read(path); },
    writeText: function (path, value) { files.write(path, value); },
    sha256File: sha256File,
    download: function (url, target) {
      var response = http.get(url, { timeout: Math.max(15000, Number(config.upload.timeoutMs || 5000) * 4) });
      if (response.statusCode < 200 || response.statusCode >= 300) throw new Error("biz scripts download failed: " + response.statusCode);
      var bytes = response.body.bytes();
      files.writeBytes(target, bytes);
      return bytes.length;
    },
    unzip: unzip,
    now: function () { return Date.now(); },
    restart: function () { exit(); }
  };
}

function createBizScriptUpdater(config, logger, uploader, dependencies) {
  var deps = dependencies || createDefaultDeps(config);
  var root = config.runtime.bizScriptRoot || joinPath(config.runtime.scriptDir, "biz-scripts");
  var currentDir = joinPath(root, "current");
  var backupRoot = joinPath(root, "backup");
  var workRoot = joinPath(root, "work");
  var lastCheckAt = 0;

  function report(eventType, fromVersion, toVersion, message, payload) {
    return uploader.uploadAgentUpdateEvent({
      eventType: eventType,
      fromVersion: fromVersion,
      toVersion: toVersion,
      message: message,
      payload: Object.assign({ channel: "biz-scripts" }, payload || {})
    });
  }

  function currentVersion() {
    var versionPath = joinPath(currentDir, "version.json");
    if (!deps.exists(versionPath)) return "0.0.0";
    try { return String(JSON.parse(deps.readText(versionPath)).version || "0.0.0"); } catch (error) { return "0.0.0"; }
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
    var latest = versionResult && versionResult.latestVersion;
    var fromVersion = currentVersion();
    if (!latest || latest.channel !== "biz-scripts" || !latest.packageUrl || !latest.version) {
      return { applied: false, rolledBack: false, message: "no biz-scripts update" };
    }
    var workDir = joinPath(workRoot, "work-" + latest.version + "-" + deps.now());
    var zipPath = joinPath(workDir, "package.zip");
    var extractDir = joinPath(workDir, "extract");
    var nextDir = joinPath(workDir, "next");
    var backupDir = joinPath(backupRoot, fromVersion + "-" + deps.now());
    var backupCreated = false;
    try {
      deps.ensureDir(workDir);
      var size = deps.download(latest.packageUrl, zipPath);
      var packageSha = deps.sha256File(zipPath).toLowerCase();
      if (latest.sha256 && packageSha !== String(latest.sha256).toLowerCase()) throw new Error("biz scripts package sha256 mismatch");
      report("DOWNLOADED", fromVersion, latest.version, "biz scripts downloaded", { sha256: packageSha, sizeBytes: size });
      deps.unzip(zipPath, extractDir);
      if (deps.exists(currentDir)) {
        deps.ensureDir(backupDir);
        deps.copyDir(currentDir, backupDir);
        backupCreated = true;
      }
      var manifestPath = joinPath(extractDir, latest.entryFile || "biz-script-manifest.json");
      var manifest = JSON.parse(deps.readText(manifestPath));
      var manifestFiles = validateManifest(manifest, latest.version);
      for (var i = 0; i < manifestFiles.length; i++) {
        var file = manifestFiles[i];
        var actual = deps.sha256File(joinPath(extractDir, file.path)).toLowerCase();
        if (actual !== file.sha256) throw new Error("biz scripts file sha256 mismatch: " + file.path);
      }
      report("VERIFIED", fromVersion, latest.version, "biz scripts verified", { fileCount: manifestFiles.length });
      deps.ensureDir(nextDir);
      if (deps.exists(joinPath(extractDir, "features"))) deps.copyDir(joinPath(extractDir, "features"), joinPath(nextDir, "features"));
      if (deps.exists(joinPath(extractDir, "domain"))) deps.copyDir(joinPath(extractDir, "domain"), joinPath(nextDir, "domain"));
      deps.writeText(joinPath(nextDir, "version.json"), JSON.stringify({ version: latest.version, channel: "biz-scripts" }));
      deps.remove(currentDir);
      deps.moveDir(nextDir, currentDir);
      config.runtime.bizScriptsVersion = latest.version;
      report("APPLIED", fromVersion, latest.version, "biz scripts applied", { fileCount: manifestFiles.length });
      logger.info("业务脚本热更新完成", { fromVersion: fromVersion, toVersion: latest.version });
      deps.restart();
      return { applied: true, rolledBack: false, version: latest.version };
    } catch (error) {
      var rolledBack = false;
      if (backupCreated) {
        deps.remove(currentDir);
        deps.copyDir(backupDir, currentDir);
        config.runtime.bizScriptsVersion = fromVersion;
        rolledBack = true;
      }
      report("FAILED", fromVersion, latest.version, String(error), {});
      if (rolledBack) report("ROLLBACK", latest.version, fromVersion, "biz scripts rollback completed", {});
      logger.warn("业务脚本热更新失败", { message: String(error), rolledBack: rolledBack });
      return { applied: false, rolledBack: rolledBack, message: String(error) };
    }
  }

  function check(force) {
    if (config.upload.bizScriptVersionCheckEnabled === false) return { checked: false, disabled: true };
    if (!isDeviceRegistrationReady()) {
      return { checked: false, deferred: true, reason: "device_not_registered" };
    }
    var interval = Math.max(1, Number(config.upload.bizScriptVersionCheckIntervalMinutes || 30)) * 60 * 1000;
    if (!force && lastCheckAt && deps.now() - lastCheckAt < interval) return { checked: false, skipped: true };
    lastCheckAt = deps.now();
    var version = currentVersion();
    config.runtime.bizScriptsVersion = version;
    var result = queryBizScriptVersion(version);
    if (!result) {
      lastCheckAt = 0;
      return { checked: true, updateAvailable: false };
    }
    report("CHECKED", version, result.latestVersion && result.latestVersion.version, "biz scripts version checked", {
      updateAvailable: !!result.updateAvailable
    });
    if (result.updateAvailable && result.latestVersion) return applyVersion(result);
    return { checked: true, updateAvailable: false, version: version };
  }

  config.runtime.bizScriptsVersion = currentVersion();
  return { check: check, applyVersion: applyVersion, currentVersion: currentVersion };
}

module.exports = {
  compareBizVersions: compareBizVersions,
  createBizScriptUpdater: createBizScriptUpdater,
  validateManifest: validateManifest
};
