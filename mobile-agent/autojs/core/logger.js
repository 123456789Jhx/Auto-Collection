function ensureDir(dirPath) {
  if (!files.exists(dirPath)) {
    files.createWithDirs(dirPath + "/.keep");
    files.remove(dirPath + "/.keep");
  }
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
  if (config.output.writeLogFile) {
    ensureDir(config.output.logDir);
    logFile = buildLogFile(new Date());
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
    if (config.output.writeLogFile) {
      currentLogFile(now);
      rotateLogIfNeeded();
      files.append(logFile, line + "\n");
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
