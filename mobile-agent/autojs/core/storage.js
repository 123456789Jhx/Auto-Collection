function ensureDir(dirPath) {
  if (!dirPath) {
    console.log("[WARN] ensureDir 跳过：目录路径为空");
    return false;
  }
  try {
    if (files.exists(dirPath)) {
      return true;
    }
    // createWithDirs 失败时可能返回 false，也可能抛异常，两者都必须兜住，
    // 否则未捕获异常会中断整个脚本引擎。
    if (files.createWithDirs(dirPath + "/.keep") === false) {
      console.log("[WARN] ensureDir 失败：" + dirPath);
      return false;
    }
    files.remove(dirPath + "/.keep");
  } catch (error) {
    console.log("[WARN] ensureDir 失败：" + dirPath + " -> " + error);
    return false;
  }
  return true;
}

function safeName(value) {
  return String(value || "unknown").replace(/[^\w.-]+/g, "_");
}

function nowCompact() {
  var date = new Date();
  function pad(value) {
    return value < 10 ? "0" + value : "" + value;
  }
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    "_",
    date.getMilliseconds()
  ].join("");
}

function datePart(date) {
  function pad(value) {
    return value < 10 ? "0" + value : "" + value;
  }
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
}

function createStorage(config, logger) {
  ensureDir(config.output.baseDir);
  ensureDir(config.output.cacheDir);

  function saveCandidate(candidate) {
    var fileName = safeName(candidate.taskId) + "_" + nowCompact() + ".json";
    var filePath = config.output.cacheDir + "/" + fileName;
    files.write(filePath, JSON.stringify(candidate, null, 2));
    logger.info("候选记录已写入本地缓存", { filePath: filePath });
    return filePath;
  }

  function liveCommentLogDir() {
    var dirPath = config.output.baseDir + "/live-comment-actions";
    ensureDir(dirPath);
    return dirPath;
  }

  function appendLiveCommentLog(entry) {
    var now = new Date();
    var payload = entry || {};
    if (!payload.loggedAt) {
      payload.loggedAt = now.toISOString();
    }
    var filePath = liveCommentLogDir() + "/" + datePart(now) + ".jsonl";
    files.append(filePath, JSON.stringify(payload) + "\n");
    logger.info("M3 live comment action logged", {
      filePath: filePath,
      status: payload.status || "",
      triggerEventId: payload.triggerEventId || "",
      replyText: payload.replyText || ""
    });
    return filePath;
  }

  function saveScreenshot(image, scene) {
    if (!config.task.saveScreenshots) {
      return "";
    }
    if (!image) {
      return "";
    }
    ensureDir(config.output.screenshotDir);
    var fileName = safeName(scene || "screen") + "_" + nowCompact() + ".png";
    var filePath = config.output.screenshotDir + "/" + fileName;
    images.save(image, filePath, "png", 100);
    logger.info("截图已保存", { filePath: filePath });
    return filePath;
  }

  function listCachedCandidates() {
    ensureDir(config.output.cacheDir);
    return files
      .listDir(config.output.cacheDir, function (name) {
        return name.endsWith(".json") && !name.endsWith(".uploaded.json");
      })
      .map(function (name) {
        return config.output.cacheDir + "/" + name;
      });
  }

  function readJson(filePath) {
    return JSON.parse(files.read(filePath));
  }

  function markUploaded(filePath) {
    var targetPath = filePath.replace(/\.json$/, ".uploaded.json");
    files.rename(filePath, files.getName(targetPath));
    if (files.exists(filePath) && !files.exists(targetPath)) {
      throw new Error("failed to mark uploaded: " + filePath);
    }
    return targetPath;
  }

  return {
    saveCandidate: saveCandidate,
    appendLiveCommentLog: appendLiveCommentLog,
    saveScreenshot: saveScreenshot,
    listCachedCandidates: listCachedCandidates,
    readJson: readJson,
    markUploaded: markUploaded
  };
}

module.exports = {
  createStorage: createStorage
};
