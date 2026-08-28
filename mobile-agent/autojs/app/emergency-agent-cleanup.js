"use strict";

var STORAGE_NAME = "AgriVideoCollectorEmergencyCleanup";

function parseJson(value, fallback) {
  try { return JSON.parse(String(value || "")); } catch (error) { return fallback; }
}

function createStorage(options) {
  if (options && options.storage) return options.storage;
  try { return storages.create(STORAGE_NAME); } catch (error) { return null; }
}

function readStored(storage, key) {
  try { return storage && storage.get ? storage.get(key, "") : ""; } catch (error) { return ""; }
}

function writeStored(storage, key, value) {
  try { if (storage && storage.put) storage.put(key, value); } catch (error) {}
}

function runEmergencyCleanup(options) {
  options = options || {};
  var storage = createStorage(options);
  var request = options.request || parseJson(readStored(storage, "request"), {});
  var cleanupKey = String(request.cleanupKey || request.sessionId || request.deviceId || "default");
  var cached = parseJson(readStored(storage, "result:" + cleanupKey), null);
  if (cached && cached.terminal === true) return cached;

  var result = { terminal: true, cleanupKey: cleanupKey, status: "FAILED", reason: "CLEANUP_MODULE_UNAVAILABLE" };
  try {
    var cleanupModule = require("../features/new-comment/cleanup.js");
    var cleanup = cleanupModule && cleanupModule.createIsolatedCleanup
      ? cleanupModule.createIsolatedCleanup({}, options.cleanupOptions || {}) : null;
    if (!cleanup || typeof cleanup.run !== "function") throw new Error("CLEANUP_MODULE_UNAVAILABLE");
    var cleanupResult = cleanup.run(request.payload || request, {});
    result = {
      terminal: true,
      cleanupKey: cleanupKey,
      status: cleanupResult && cleanupResult.completed === false ? "FAILED" : "SUCCESS",
      reason: cleanupResult && (cleanupResult.reason || cleanupResult.cleanupReason || "") || "",
      cleanup: cleanupResult || null,
      stages: {
        EXIT_DOUYIN: cleanupResult && cleanupResult.completed === false ? "FAILED" : "SUCCESS",
        OPEN_AGENT_HOME: cleanupResult && cleanupResult.fallback ? "SUCCESS" : (cleanupResult && cleanupResult.completed ? "SUCCESS" : "FAILED")
      }
    };
  } catch (error) {
    result.reason = String(error);
  }
  writeStored(storage, "result:" + cleanupKey, JSON.stringify(result));
  writeStored(storage, "lastResult", JSON.stringify(result));
  return result;
}

if (typeof module !== "undefined") module.exports = { runEmergencyCleanup: runEmergencyCleanup };

try {
  if (typeof module === "undefined" || !module.parent) runEmergencyCleanup({});
} catch (error) {}
