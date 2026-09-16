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

function pad(value) {
  return value < 10 ? "0" + value : "" + value;
}

function datePart(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-");
}

function timePart(date) {
  return [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(":");
}

function createLogger(config) {
  var logFile = "";
  var repeatState = {};
  var fileLoggingDisabled = false;
  if (config.output.writeLogFile && !ensureDir(config.output.logDir)) {
    fileLoggingDisabled = true;
    console.log("[WARN] 日志目录不可用，本次运行仅输出控制台日志");
  }
  if (config.output.writeLogFile && !fileLoggingDisabled && config.output.logDir) {
    logFile = buildLogFile(new Date());
  }

  function fileLoggingEnabled() {
    if (!config.output.writeLogFile || fileLoggingDisabled) {
      return false;
    }
    if (!config.output.logDir) {
      fileLoggingDisabled = true;
      console.log("[WARN] 日志目录为空，本次运行仅输出控制台日志");
      return false;
    }
    return true;
  }

  function buildLogFile(date) {
    return config.output.logDir + "/" + datePart(date) + ".log";
  }

  function currentLogFile(now) {
    if (!config.output.writeLogFile) {
      return "";
    }
    ensureDir(config.output.logDir);
    logFile = buildLogFile(now || new Date());
    return logFile;
  }

  function fileSize(filePath) {
    try {
      if (!files.exists(filePath)) {
        return 0;
      }
      if (files.getSize) {
        return files.getSize(filePath);
      }
      return new java.io.File(filePath).length();
    } catch (error) {
      return 0;
    }
  }

  function rotateLogIfNeeded() {
    if (!config.output.writeLogFile || !logFile) {
      return;
    }
    var maxBytes = Number(config.output.maxLogFileBytes || 3 * 1024 * 1024);
    if (maxBytes <= 0 || fileSize(logFile) < maxBytes) {
      return;
    }
    try {
      var backupFile = logFile + ".1";
      if (files.exists(backupFile)) {
        files.remove(backupFile);
      }
      files.rename(logFile, files.getName(backupFile));
    } catch (error) {
      try {
        files.remove(logFile);
      } catch (removeError) {
      }
    }
  }

  function normalizeExtra(extra) {
    if (extra === undefined) {
      return "";
    }
    try {
      return JSON.stringify(extra);
    } catch (error) {
      return String(extra);
    }
  }

  function shouldWrite(level, message, extra) {
    if (level !== "WARN" && level !== "ERROR") {
      return true;
    }
    var text = normalizeExtra(extra);
    var isNetworkFailure =
      text.indexOf("ConnectException") >= 0 ||
      text.indexOf("SocketTimeoutException") >= 0 ||
      text.indexOf("Failed to connect") >= 0 ||
      text.indexOf("failed to connect") >= 0;
    if (!isNetworkFailure) {
      return true;
    }
    var key = level + "|" + message;
    var now = Date.now();
    var state = repeatState[key] || {
      count: 0,
      firstAt: now,
      lastLogAt: 0
    };
    state.count += 1;
    var intervalMs = Number(config.output.repeatWarnLogIntervalMs || 5 * 60 * 1000);
    var should = state.count === 1 || state.count % 10 === 0 || now - state.lastLogAt >= intervalMs;
    if (should) {
      state.lastLogAt = now;
      if (extra && typeof extra === "object") {
        extra.repeatCount = state.count;
        extra.repeatElapsedSeconds = Math.round((now - state.firstAt) / 1000);
      }
    }
    repeatState[key] = state;
    return should;
  }

  function write(level, message, extra) {
    if (!shouldWrite(level, message, extra)) {
      return;
    }
    var now = new Date();
    var line = "[" + datePart(now) + " " + timePart(now) + "] [" + level + "] " + message;
    if (extra !== undefined) {
      try {
        line += " " + JSON.stringify(extra);
      } catch (error) {
        line += " " + extra;
      }
    }
    console.log(line);
    if (fileLoggingEnabled()) {
      try {
        currentLogFile(now);
        rotateLogIfNeeded();
        files.append(logFile, line + "\n");
      } catch (fileError) {
        fileLoggingDisabled = true;
        console.log("[WARN] 日志文件写入失败，已降级为仅控制台日志：" + fileError);
      }
    }
  }

  return {
    debug: function (message, extra) {
      write("DEBUG", message, extra);
    },
    info: function (message, extra) {
      write("INFO", message, extra);
    },
    warn: function (message, extra) {
      write("WARN", message, extra);
    },
    error: function (message, extra) {
      write("ERROR", message, extra);
    },
    getLogFile: function () {
      return currentLogFile(new Date());
    }
  };
}

module.exports = {
  createLogger: createLogger
};
