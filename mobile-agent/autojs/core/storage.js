function ensureDir(dirPath) {
  if (!files.exists(dirPath)) {
    files.createWithDirs(dirPath + "/.keep");
    files.remove(dirPath + "/.keep");
  }
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
    return targetPath;
  }

  return {
    saveCandidate: saveCandidate,
    saveScreenshot: saveScreenshot,
    listCachedCandidates: listCachedCandidates,
    readJson: readJson,
    markUploaded: markUploaded
  };
}

module.exports = {
  createStorage: createStorage
};
