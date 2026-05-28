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
  if (config.output.writeLogFile) {
    ensureDir(config.output.logDir);
    logFile = config.output.logDir + "/" + datePart(new Date()) + ".log";
  }

  function write(level, message, extra) {
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
    if (config.output.writeLogFile && logFile) {
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
    }
  };
}

module.exports = {
  createLogger: createLogger
};
