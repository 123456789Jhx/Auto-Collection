"use strict";

var MAX_WAIT_MS = 120000;
var ACTION_KEYS = [
  "openDouyin", "openSearchEntry", "setSearchKeyword", "submitSearch",
  "openLiveTab", "openFirstLive", "readViewerCount", "detectCommerceCart",
  "openAnchorSummary", "openAnchorProfile", "readRoomIdentity",
  "closeAnchorProfile", "readComments", "swipeComments", "nextLive",
  "commentOcrRetry", "finishRoomCapture"
];
var DEFAULT_ACTIONS = {
  openDouyin: { beforeMs: [0, 0], afterMs: [5000, 7000] },
  openSearchEntry: { beforeMs: [0, 0], afterMs: [600, 1000] },
  setSearchKeyword: { beforeMs: [0, 0], afterMs: [500, 800] },
  submitSearch: { beforeMs: [0, 0], afterMs: [300, 900] },
  openLiveTab: { beforeMs: [0, 0], afterMs: [3500, 7000] },
  openFirstLive: { beforeMs: [0, 0], afterMs: [7500, 8500] },
  readViewerCount: { beforeMs: [0, 0], afterMs: [0, 0] },
  detectCommerceCart: { beforeMs: [0, 0], afterMs: [0, 0] },
  openAnchorSummary: { beforeMs: [5000, 7000], afterMs: [0, 0] },
  openAnchorProfile: { beforeMs: [5000, 7000], afterMs: [0, 0] },
  readRoomIdentity: { beforeMs: [5000, 7000], afterMs: [0, 0] },
  closeAnchorProfile: { beforeMs: [5000, 7000], afterMs: [0, 0] },
  readComments: { beforeMs: [0, 0], afterMs: [0, 0] },
  swipeComments: { beforeMs: [0, 0], afterMs: [2500, 4500] },
  nextLive: { beforeMs: [0, 0], afterMs: [7500, 8500] },
  commentOcrRetry: { beforeMs: [350, 650], afterMs: [0, 0] },
  finishRoomCapture: { beforeMs: [0, 0], afterMs: [800, 1200] }
};

function copyPair(pair) { return [pair[0], pair[1]]; }
function validRange(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  var min = value[0], max = value[1];
  if (typeof min !== "number" || typeof max !== "number" || !isFinite(min) || !isFinite(max) ||
    Math.floor(min) !== min || Math.floor(max) !== max || min < 0 || max < min || max > MAX_WAIT_MS) return null;
  return [min, max];
}
function normalizeActions(profile) {
  var normalized = {};
  ACTION_KEYS.forEach(function (key) {
    var defaults = DEFAULT_ACTIONS[key];
    normalized[key] = { beforeMs: copyPair(defaults.beforeMs), afterMs: copyPair(defaults.afterMs) };
  });
  if (!profile || profile.enabled === false || profile.schemaVersion !== 1 || !profile.actions) return normalized;
  ACTION_KEYS.forEach(function (key) {
    var source = profile.actions[key];
    if (!source || typeof source !== "object") return;
    var before = validRange(source.beforeMs);
    var after = validRange(source.afterMs);
    if (before) normalized[key].beforeMs = before;
    if (after) normalized[key].afterMs = after;
  });
  return normalized;
}

function createActionTiming(options) {
  options = options || {};
  var logger = options.logger || {};
  function currentProfile() {
    try { return typeof options.getProfile === "function" ? options.getProfile() : options.profile || null; }
    catch (error) { return null; }
  }
  function profileSnapshot() {
    var profile = currentProfile();
    var actions = normalizeActions(profile);
    var sources = {};
    ACTION_KEYS.forEach(function (key) { sources[key] = profile && profile.enabled === false ? "disabled_default" : "default"; });
    if (profile && profile.enabled !== false && profile.schemaVersion === 1 && profile.actions) {
      ACTION_KEYS.forEach(function (key) {
        var action = profile.actions[key];
        if (action && (validRange(action.beforeMs) || validRange(action.afterMs))) sources[key] = "device_profile";
      });
    }
    var hasDedicatedOpen = !!(profile && profile.enabled !== false && profile.schemaVersion === 1 &&
      profile.actions && validRange(profile.actions.openDouyin && profile.actions.openDouyin.afterMs));
    if (!hasDedicatedOpen && typeof options.openDouyinFallback === "function") {
      var fallback = validRange(options.openDouyinFallback());
      if (fallback) { actions.openDouyin.afterMs = fallback; sources.openDouyin = profile && profile.enabled === false
        ? "disabled_legacy_open_douyin" : "legacy_open_douyin"; }
    }
    var raw = JSON.stringify(actions);
    var hash = 2166136261;
    for (var index = 0; index < raw.length; index += 1) {
      hash ^= raw.charCodeAt(index);
      hash = (hash * 16777619) >>> 0;
    }
    return { schemaVersion: 1, enabled: !(profile && profile.enabled === false),
      source: profile && profile.enabled === false ? "disabled_default" : profile ? "device_profile" : "default",
      hash: ("00000000" + hash.toString(16)).slice(-8), hashAlgorithm: "diagnostic-fnv1a32",
      sources: sources, actions: actions };
  }
  function stopped(control) {
    try { return !!(control && typeof control.shouldStop === "function" && control.shouldStop()); }
    catch (error) { return true; }
  }
  function range(key, side, frozen) {
    var action = (frozen || profileSnapshot()).actions[key];
    if (!action) return [0, 0];
    if (side === "before") return copyPair(action.beforeMs);
    if (side === "after") return copyPair(action.afterMs);
    if (action.afterMs[0] || action.afterMs[1]) return copyPair(action.afterMs);
    return copyPair(action.beforeMs);
  }
  function sample(pair) {
    if (pair[0] === pair[1]) return pair[0];
    var random = typeof options.random === "function" ? options.random : Math.random;
    var raw;
    try { raw = random(pair[0], pair[1]); } catch (error) { raw = pair[0]; }
    if (raw >= pair[0] && raw <= pair[1] && Math.floor(raw) === raw) return raw;
    raw = Math.max(0, Math.min(0.999999999, Number(raw) || 0));
    return Math.floor(pair[0] + raw * (pair[1] - pair[0] + 1));
  }
  function wait(key, control, details) {
    details = details || {};
    var frozen = details.snapshot || profileSnapshot();
    var selected = range(key, details.side, frozen);
    var remaining = typeof details.remainingMs === "function" ? details.remainingMs() : details.remainingMs;
    if (isFinite(Number(remaining))) {
      var cap = Math.max(0, Math.floor(Number(remaining)));
      selected = [Math.min(selected[0], cap), Math.min(selected[1], cap)];
    }
    var duration = sample(selected);
    var startedAt = Date.now();
    var elapsed = 0;
    var result = { success: true, value: duration };
    if (stopped(control)) result = { success: false, stopped: true, reason: "STOP_REQUESTED", value: 0 };
    try {
      while (result.success && elapsed < duration) {
        if (stopped(control)) { result = { success: false, stopped: true, reason: "STOP_REQUESTED", value: elapsed }; break; }
        var slice = Math.min(100, duration - elapsed);
        if (typeof options.sleep !== "function") { result = { success: false, reason: "DEPENDENCY_MISSING", message: "sleep unavailable" }; break; }
        if (options.sleep(slice) === false && options.allowMissingSleep !== true) {
          result = { success: false, reason: "SLEEP_ERROR", message: "sleep returned false" }; break;
        }
        elapsed += slice;
      }
    } catch (error) {
      result = { success: false, reason: "SLEEP_ERROR", message: String(error && error.message || error) };
    }
    if (result.success && stopped(control)) result = { success: false, stopped: true, reason: "STOP_REQUESTED", value: elapsed };
    var actualMs = Math.max(0, Date.now() - startedAt);
    try {
      if (typeof logger.info === "function") logger.info("comment action timing wait", {
        actionKey: key, side: details.side === "before" ? "before" : "after",
        minMs: selected[0], maxMs: selected[1], sampledMs: duration, actualMs: actualMs,
        source: frozen.sources[key], profileHash: frozen.hash, hashAlgorithm: frozen.hashAlgorithm,
        purpose: details.purpose || "", success: result.success !== false
      });
    } catch (error3) {}
    return result;
  }
  function run(key, action, control, details) {
    var frozen = profileSnapshot();
    var before = wait(key, control, { side: "before", snapshot: frozen,
      remainingMs: details && details.remainingMs, purpose: details && details.purpose || key });
    if (!before.success) return before;
    var remaining = details && (typeof details.remainingMs === "function" ? details.remainingMs() : details.remainingMs);
    if (isFinite(Number(remaining)) && Number(remaining) <= 0) {
      return { success: false, reason: "TIMING_DEADLINE_REACHED", message: "action timing deadline reached" };
    }
    if (stopped(control)) return { success: false, stopped: true, reason: "STOP_REQUESTED" };
    var result;
    try { result = action(); }
    catch (error) { return { success: false, reason: "DRIVER_ERROR", message: String(error && error.message || error) }; }
    if (result === false || result && result.success === false) return result || { success: false, reason: "DRIVER_REJECTED" };
    var afterActionRemaining = details && (typeof details.remainingMs === "function" ? details.remainingMs() : details.remainingMs);
    if (result && typeof result === "object" && isFinite(Number(afterActionRemaining))) {
      result.timingCompletedBeforeDeadline = Number(afterActionRemaining) > 0;
    }
    var after = wait(key, control, { side: "after", snapshot: frozen,
      remainingMs: details && details.remainingMs, purpose: details && details.purpose || key });
    if (!after.success && after.stopped) return result;
    return after.success ? result : after;
  }
  return { wait: wait, run: run, range: range, snapshot: profileSnapshot };
}

module.exports = {
  ACTION_KEYS: ACTION_KEYS,
  DEFAULT_ACTIONS: DEFAULT_ACTIONS,
  MAX_WAIT_MS: MAX_WAIT_MS,
  createActionTiming: createActionTiming
};
