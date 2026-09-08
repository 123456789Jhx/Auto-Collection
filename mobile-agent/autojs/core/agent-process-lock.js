"use strict";

function defaultFileFactory(filePath) {
  if (typeof java === "undefined" || !java.io || !java.io.RandomAccessFile) {
    return null;
  }
  return new java.io.RandomAccessFile(filePath, "rw");
}

function closeQuietly(value) {
  if (!value || typeof value.close !== "function") return;
  try {
    value.close();
  } catch (error) {
  }
}

function createAgentProcessLock(options) {
  options = options || {};
  var filePath = String(options.path || "");
  var fileFactory = options.fileFactory || defaultFileFactory;
  var logger = options.logger || null;
  var file = null;
  var channel = null;
  var heldLock = null;

  function report(level, message, details) {
    if (logger && typeof logger[level] === "function") {
      try {
        logger[level](message, details || {});
      } catch (error) {
      }
    }
  }

  function discardHandle() {
    closeQuietly(channel);
    closeQuietly(file);
    channel = null;
    file = null;
  }

  function acquire() {
    if (heldLock) return true;
    if (!filePath) {
      report("error", "Agent 进程锁路径为空");
      return false;
    }

    try {
      file = fileFactory(filePath);
      if (!file || typeof file.getChannel !== "function") {
        throw new Error("file lock is unavailable");
      }
      channel = file.getChannel();
      if (!channel || typeof channel.tryLock !== "function") {
        throw new Error("file channel lock is unavailable");
      }
      heldLock = channel.tryLock();
      if (!heldLock) {
        discardHandle();
        report("warn", "Agent 进程锁已被占用", { path: filePath });
        return false;
      }
      report("info", "Agent 进程锁获取成功", { path: filePath });
      return true;
    } catch (error) {
      heldLock = null;
      discardHandle();
      report("warn", "Agent 进程锁获取失败", {
        path: filePath,
        message: String(error)
      });
      return false;
    }
  }

  function release() {
    if (!heldLock) return false;
    var lock = heldLock;
    heldLock = null;
    try {
      if (lock && typeof lock.release === "function") lock.release();
    } catch (error) {
      report("warn", "Agent 进程锁释放失败", {
        path: filePath,
        message: String(error)
      });
    }
    discardHandle();
    return true;
  }

  return {
    acquire: acquire,
    release: release,
    isHeld: function () { return !!heldLock; },
    path: filePath
  };
}

module.exports = {
  createAgentProcessLock: createAgentProcessLock
};

