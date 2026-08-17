// 原中文名：发布任务锁.js；职责：串行化发布任务执行。
var fallbackLockValues = {};
var LOCK_STORAGE_NAME = "AgriVideoPublishTaskLock";
var LOCK_KEY = "active";
var LOCK_TTL_MS = 15 * 60 * 1000;

function createFallbackStorage() {
  return {
    get: function (key, fallback) {
      return Object.prototype.hasOwnProperty.call(fallbackLockValues, key)
        ? fallbackLockValues[key]
        : fallback;
    },
    put: function (key, value) { fallbackLockValues[key] = value; },
    remove: function (key) { delete fallbackLockValues[key]; }
  };
}

function defaultStorage() {
  if (typeof storages !== "undefined" && storages && storages.create) {
    return storages.create(LOCK_STORAGE_NAME);
  }
  return createFallbackStorage();
}

function createOwnerId(now) {
  return "publish-" + now() + "-" + Math.floor(Math.random() * 1000000000);
}

function createPublishTaskLock(dependencies) {
  dependencies = dependencies || {};
  var storage = dependencies.storage || defaultStorage();
  var now = dependencies.now || function () { return Date.now(); };
  var ownerId = String(dependencies.ownerId || createOwnerId(now));
  var logger = dependencies.logger || { info: function () {}, warn: function () {} };
  var acquired = false;

  function inspect() {
    return storage.get(LOCK_KEY, null);
  }

  function acquire(meta) {
    meta = meta || {};
    var currentTime = now();
    var current = storage.get(LOCK_KEY, null);
    var acquiredAt = Number(current && (current.acquiredAt || current.timestamp) || current || 0);
    var expiresAt = Number(current && current.expiresAt || acquiredAt + LOCK_TTL_MS);
    var active = acquiredAt > 0 && acquiredAt <= currentTime && expiresAt > currentTime;
    if (active) {
      logger.warn("发布任务锁仍被占用", {
        ownerId: String(current && current.ownerId || ""),
        taskId: String(current && current.taskId || ""),
        commandId: String(current && current.commandId || ""),
        acquiredAt: acquiredAt,
        expiresAt: expiresAt
      });
      return false;
    }
    if (current) {
      logger.warn("发布任务锁异常或过期，允许新任务接管", {
        ownerId: String(current.ownerId || ""),
        acquiredAt: acquiredAt,
        expiresAt: expiresAt,
        now: currentTime
      });
      storage.remove(LOCK_KEY);
    }
    storage.put(LOCK_KEY, {
      ownerId: ownerId,
      taskId: String(meta.taskId || ""),
      commandId: String(meta.commandId || ""),
      acquiredAt: currentTime,
      expiresAt: currentTime + LOCK_TTL_MS,
      timestamp: currentTime
    });
    acquired = true;
    logger.info("发布任务锁获取成功", {
      ownerId: ownerId,
      taskId: String(meta.taskId || ""),
      commandId: String(meta.commandId || ""),
      expiresAt: currentTime + LOCK_TTL_MS
    });
    return true;
  }

  function release() {
    if (!acquired) return false;
    var current = storage.get(LOCK_KEY, null);
    if (!current || String(current.ownerId || "") !== ownerId) {
      acquired = false;
      return false;
    }
    storage.remove(LOCK_KEY);
    acquired = false;
    return true;
  }

  return { acquire: acquire, release: release, inspect: inspect };
}

module.exports = {
  createPublishTaskLock: createPublishTaskLock
};
