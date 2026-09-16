// 原中文名：素材目录管理.js；职责：管理发布素材目录、下载与归档。
var fallbackStorageValues = {};
var MATERIAL_STORAGE_NAME = "AgriVideoPublishMaterial";
var MATERIAL_DIR_PATTERN = /^20\d{6}(（\d+）)?$/;
var DEFAULT_DOWNLOAD_TIMEOUT_MS = 20000;

function joinPath() {
  return Array.prototype.slice.call(arguments).filter(function (value) {
    return value !== null && value !== undefined && String(value) !== "";
  }).join("/").replace(/\/+/g, "/");
}

function nonEmpty(value) {
  var normalized = String(value === null || value === undefined ? "" : value).trim();
  return normalized || "";
}

function createFallbackStorage() {
  return {
    get: function (key, fallback) {
      return Object.prototype.hasOwnProperty.call(fallbackStorageValues, key)
        ? fallbackStorageValues[key]
        : fallback;
    },
    put: function (key, value) { fallbackStorageValues[key] = value; },
    remove: function (key) { delete fallbackStorageValues[key]; }
  };
}

function defaultStorage() {
  if (typeof storages !== "undefined" && storages && storages.create) {
    return storages.create(MATERIAL_STORAGE_NAME);
  }
  return createFallbackStorage();
}

function dateKey(date) {
  function pad(value) { return value < 10 ? "0" + value : String(value); }
  return String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate());
}

function directoryName(key, sequence) {
  return sequence === 0 ? key : key + "（" + sequence + "）";
}

function isAllowedMaterialFile(name) {
  return name === ".keep" || /^video\.[^/]+$/i.test(name) || /^cover\.[^/]+$/i.test(name);
}

function errorMessage(error) {
  return String(error && error.message || error || "未知错误");
}

function createPublishMaterialManager(dependencies) {
  dependencies = dependencies || {};
  var filesApi = dependencies.files || (typeof files !== "undefined" ? files : null);
  var storage = dependencies.storage || defaultStorage();
  var httpApi = dependencies.http || (typeof http !== "undefined" ? http : null);
  var mediaApi = dependencies.media || (typeof media !== "undefined" ? media : null);
  var logger = dependencies.logger || { warn: function () {} };
  var now = dependencies.now || function () { return new Date(); };

  function resolveRoot(payload, config) {
    payload = payload || {};
    config = config || {};
    return nonEmpty(payload.downloadDir) || nonEmpty(config.publishMaterialRoot) || "/sdcard/";
  }

  function ensureDirectory(path, keepFile) {
    if (!path) {
      logger.warn("素材目录为空，已跳过创建");
      return false;
    }
    try {
      if (filesApi.exists(path)) return true;
      var marker = joinPath(path, ".keep");
      // createWithDirs 失败时可能返回 false，也可能抛异常，两者都必须兜住，
      // 否则未捕获异常会中断整个脚本引擎。
      if (filesApi.createWithDirs(marker) === false) {
        logger.warn("素材目录创建失败", { path: path });
        return false;
      }
      if (!keepFile) filesApi.remove(marker);
    } catch (error) {
      logger.warn("素材目录创建异常", { path: path, message: errorMessage(error) });
      return false;
    }
    return true;
  }

  function canRemoveDirectory(path) {
    var names = filesApi.listDir(path) || [];
    for (var index = 0; index < names.length; index += 1) {
      var child = joinPath(path, names[index]);
      if (filesApi.isDir(child) || !isAllowedMaterialFile(names[index])) return false;
    }
    return true;
  }

  function sweepStale(root) {
    var normalizedRoot = resolveRoot({ downloadDir: root }, {});
    ensureDirectory(normalizedRoot, false);
    var names = filesApi.listDir(normalizedRoot) || [];
    var removed = [];
    for (var index = 0; index < names.length; index += 1) {
      var name = names[index];
      var path = joinPath(normalizedRoot, name);
      if (!MATERIAL_DIR_PATTERN.test(name) || !filesApi.isDir(path)) continue;
      if (!canRemoveDirectory(path)) {
        logger.warn("跳过素材目录清理：目录含非白名单文件", { dir: path });
        continue;
      }
      try {
        if (filesApi.removeDir(path) !== false) removed.push(path);
      } catch (error) {
        logger.warn("素材目录清理失败", { dir: path, error: errorMessage(error) });
      }
    }
    return removed;
  }

  function beginTask(payload, config) {
    var root = resolveRoot(payload, config);
    sweepStale(root);
    var key = dateKey(now());
    var counterKey = "sequence:" + key;
    var sequence = Math.max(0, Math.floor(Number(storage.get(counterKey, 0)) || 0));
    storage.put(counterKey, sequence + 1);
    var dir = joinPath(root, directoryName(key, sequence));
    ensureDirectory(dir, true);
    return {
      dir: dir,
      videoPath: joinPath(dir, "video.mp4"),
      coverPath: joinPath(dir, "cover.jpg")
    };
  }

  function scanFile(path) {
    try {
      if (mediaApi && mediaApi.scanFile) mediaApi.scanFile(path);
    } catch (error) {
      logger.warn("素材媒体扫描失败", { path: path, error: errorMessage(error) });
    }
  }

  function downloadOne(url, path, label, timeoutMs) {
    var response;
    try {
      response = httpApi.get(url, { timeout: timeoutMs });
    } catch (error) {
      throw new Error(label + "下载失败：HTTP 请求异常，" + errorMessage(error));
    }
    var statusCode = Number(response && response.statusCode || 0);
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(label + "下载失败：HTTP " + statusCode);
    }
    var bytes = response && response.body && response.body.bytes ? response.body.bytes() : null;
    if (!bytes || !bytes.length) {
      throw new Error(label + "下载失败：HTTP " + statusCode + "，文件为空");
    }
    filesApi.writeBytes(path, bytes);
    scanFile(path);
    return bytes.length;
  }

  function download(paths, payload) {
    payload = payload || {};
    var videoUrl = nonEmpty(payload.videoUrl);
    var coverUrl = nonEmpty(payload.coverUrl);
    var timeoutMs = Math.max(1000, Number(payload.materialDownloadTimeoutMs || DEFAULT_DOWNLOAD_TIMEOUT_MS));
    if (!videoUrl) throw new Error("缺少视频素材：接口 videoUrl 为空");
    if (!coverUrl) throw new Error("缺少封面素材：接口 coverUrl 为空");
    var videoBytes = downloadOne(videoUrl, paths.videoPath, "视频素材", timeoutMs);
    var coverBytes = downloadOne(coverUrl, paths.coverPath, "封面素材", timeoutMs);
    return {
      dir: paths.dir,
      videoPath: paths.videoPath,
      coverPath: paths.coverPath,
      videoBytes: videoBytes,
      coverBytes: coverBytes,
      totalBytes: videoBytes + coverBytes,
      timeoutMs: timeoutMs
    };
  }

  function endTask(dir) {
    var normalized = nonEmpty(dir).replace(/\/$/, "");
    var name = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (!normalized || !MATERIAL_DIR_PATTERN.test(name)) {
      logger.warn("拒绝删除非发布素材目录", { dir: dir });
      return false;
    }
    if (!filesApi.exists(normalized)) return true;
    try {
      return filesApi.removeDir(normalized) !== false;
    } catch (error) {
      logger.warn("本次素材目录删除失败", { dir: normalized, error: errorMessage(error) });
      return false;
    }
  }

  return {
    beginTask: beginTask,
    download: download,
    endTask: endTask,
    resolveRoot: resolveRoot,
    sweepStale: sweepStale
  };
}

module.exports = {
  createPublishMaterialManager: createPublishMaterialManager
};
