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
  var acquired = false;

  function acquire() {
    var current = storage.get(LOCK_KEY, null);
    var timestamp = Number(current && current.timestamp || current || 0);
    if (timestamp > 0 && now() - timestamp < LOCK_TTL_MS) return false;
    storage.put(LOCK_KEY, { ownerId: ownerId, timestamp: now() });
    acquired = true;
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

  return { acquire: acquire, release: release };
}

module.exports = {
  createPublishTaskLock: createPublishTaskLock
};
