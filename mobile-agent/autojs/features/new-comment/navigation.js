"use strict";

var DOUYIN_PACKAGE = "com.ss.android.ugc.aweme";
var SELECTORS = {
  searchEntry: [
    { method: "descContains", value: "搜索" },
    { method: "text", value: "搜索" }
  ],
  searchInput: [
    { method: "className", value: "android.widget.EditText" }
  ],
  searchSubmit: [
    { method: "text", value: "搜索" },
    { method: "desc", value: "搜索" }
  ],
  liveTab: [
    { method: "text", value: "直播" },
    { method: "desc", value: "直播" }
  ]
};

function createCommentNavigation(options) {
  options = options || {};
  var lookupTimeoutMs = Math.max(0, Math.min(1500, Number(options.lookupTimeoutMs) || 1200));
  function stopped() {
    try { return !!(typeof options.shouldStop === "function" && options.shouldStop()); }
    catch (error) { return true; }
  }
  function success(value) { return { success: true, value: value }; }
  function failure(reason, message) { return { success: false, reason: reason, message: message || reason }; }
  function stopResult() { return failure("STOP_REQUESTED", "task stopped"); }
  function log(level, message, details) {
    try {
      var logger = options.logger || {};
      if (typeof logger[level] === "function") logger[level](message, details || {});
    } catch (error) {}
  }
  function driver() {
    try { return typeof options.driver === "function" ? options.driver() : options.driver; }
    catch (error) { return null; }
  }
  function currentPackageName() {
    var reader = options.currentPackage || (typeof currentPackage === "function" ? currentPackage : null);
    try { return reader ? String(reader() || "") : ""; }
    catch (error) { return ""; }
  }
  function boundsOf(node) {
    if (!node) return null;
    try { return typeof node.bounds === "function" ? node.bounds() : node.bounds; }
    catch (error) { return null; }
  }
  function pointOf(node) {
    var bounds = boundsOf(node);
    if (!bounds) return null;
    return {
      x: Math.floor((Number(bounds.left) + Number(bounds.right)) / 2),
      y: Math.floor((Number(bounds.top) + Number(bounds.bottom)) / 2),
      durationMs: 180
    };
  }
  function topControl(node) {
    var bounds = boundsOf(node);
    var size = typeof options.screenSize === "function" ? options.screenSize() : options.screenSize;
    return !!(bounds && size && Number(bounds.top) < Number(size.height) * 0.25);
  }
  function sleepSlice(milliseconds) {
    if (typeof options.sleep !== "function") return;
    options.sleep(Math.min(100, Math.max(0, milliseconds)));
  }
  function selector(description) {
    try {
      if (description.method === "text" && typeof text === "function") return text(description.value);
      if (description.method === "desc" && typeof desc === "function") return desc(description.value);
      if (description.method === "descContains" && typeof descContains === "function") return descContains(description.value);
      if (description.method === "className" && typeof className === "function") return className(description.value);
    } catch (error) {}
    return null;
  }
  function findOne(descriptions, predicate) {
    var startedAt = Date.now();
    var elapsed = 0;
    while (elapsed <= lookupTimeoutMs) {
      if (stopped()) return { stopped: true };
      for (var index = 0; index < descriptions.length; index += 1) {
        var node = null;
        try {
          if (typeof options.findNode === "function") node = options.findNode(descriptions[index], predicate);
          else {
            var query = selector(descriptions[index]);
            if (query && typeof query.findOnce === "function") {
              for (var matchIndex = 0; matchIndex < 12; matchIndex += 1) {
                var candidate = query.findOnce(matchIndex);
                if (!candidate) break;
                if (!predicate || predicate(candidate)) { node = candidate; break; }
              }
            }
          }
        }
        catch (error) {}
        if (node && (!predicate || predicate(node))) return { node: node };
      }
      if (elapsed >= lookupTimeoutMs) break;
      var slice = Math.min(100, lookupTimeoutMs - elapsed);
      sleepSlice(slice);
      elapsed += slice;
    }
    log("warn", "comment navigation selector timeout", {
      elapsedMs: Math.max(elapsed, Date.now() - startedAt), selectorCount: descriptions.length
    });
    return { node: null };
  }
  function tapPoint(point, actionKey) {
    var activeDriver = driver();
    if (!activeDriver || typeof activeDriver.tap !== "function") {
      return failure("DEPENDENCY_MISSING", actionKey + " tap unavailable");
    }
    var result;
    try { result = activeDriver.tap(point); }
    catch (error) { return failure("DRIVER_ERROR", String(error && error.message || error)); }
    if (stopped()) return stopResult();
    return result === true || result && result.success === true ? success(point) :
      failure(result && result.reason || "DRIVER_REJECTED", actionKey + " tap rejected");
  }
  function tapNode(descriptions, actionKey, fallbackPoint) {
    var found = findOne(descriptions, topControl);
    if (found.stopped) return stopResult();
    var point = pointOf(found.node) || fallbackPoint;
    if (!point) return failure("NODE_TIMEOUT", actionKey + " target not found");
    if (stopped()) return stopResult();
    return tapPoint(point, actionKey);
  }
  function openDouyin() {
    if (stopped()) return stopResult();
    var launch = options.launchPackage || (typeof app !== "undefined" && app &&
      typeof app.launchPackage === "function" ? function (name) { return app.launchPackage(name); } :
      (typeof launchPackage === "function" ? launchPackage : null));
    if (!launch) return failure("DEPENDENCY_MISSING", "launchPackage unavailable");
    try {
      if (launch(DOUYIN_PACKAGE) !== true) return failure("LAUNCH_REJECTED", "Douyin launch rejected");
    } catch (error) { return failure("DRIVER_ERROR", String(error && error.message || error)); }
    if (stopped()) return stopResult();
    var confirmed = currentPackageName() === DOUYIN_PACKAGE;
    log("info", "Douyin launch dispatched", { packageName: DOUYIN_PACKAGE, foregroundConfirmed: confirmed });
    return success({ packageName: DOUYIN_PACKAGE, confirmed: confirmed });
  }
  function searchFallback() {
    if (currentPackageName() !== DOUYIN_PACKAGE) return null;
    var size = typeof options.screenSize === "function" ? options.screenSize() : options.screenSize;
    return size ? { x: Math.floor(size.width * 0.93), y: Math.floor(size.height * 0.055), durationMs: 180 } : null;
  }
  function openSearchEntry() { return tapNode(SELECTORS.searchEntry, "openSearchEntry", searchFallback()); }
  function setSearchKeyword(keyword) {
    if (stopped()) return stopResult();
    var found = findOne(SELECTORS.searchInput);
    if (found.stopped) return stopResult();
    if (!found.node || typeof found.node.setText !== "function") return failure("NODE_TIMEOUT", "search input not found");
    var expected = String(keyword || "");
    try {
      if (found.node.setText(expected) === false) return failure("INPUT_REJECTED", "keyword input rejected");
      var actual = typeof found.node.text === "function" ? String(found.node.text() || "") : expected;
      if (actual !== expected) return failure("INPUT_MISMATCH", "keyword input mismatch");
    } catch (error) { return failure("DRIVER_ERROR", String(error && error.message || error)); }
    return stopped() ? stopResult() : success({ keywordLength: expected.length });
  }
  function submitSearch() { return tapNode(SELECTORS.searchSubmit, "submitSearch", searchFallback()); }
  function openLiveTab() { return tapNode(SELECTORS.liveTab, "openLiveTab"); }
  function openFirstLive() {
    if (stopped()) return stopResult();
    var size = typeof options.screenSize === "function" ? options.screenSize() : options.screenSize;
    size = size || { width: 1080, height: 2248 };
    var random = typeof options.random === "function" ? options.random : function (min) { return min; };
    var point = { x: random(Math.floor(size.width * 0.17), Math.floor(size.width * 0.86)),
      y: random(Math.floor(size.height * 0.28), Math.floor(size.height * 0.65)), durationMs: 180 };
    return tapPoint(point, "openFirstLive");
  }
  function nextLive() {
    if (stopped()) return stopResult();
    var size = typeof options.screenSize === "function" ? options.screenSize() : options.screenSize;
    size = size || { width: 1080, height: 2248 };
    var duration = Number(options.config && options.config.runtime && options.config.runtime.swipeDurationMs);
    duration = isFinite(duration) && duration > 0 ? Math.floor(duration) : 520;
    var gesture = { points: [{ x: Math.floor(size.width * 0.5), y: Math.floor(size.height * 0.78) },
      { x: Math.floor(size.width * 0.5), y: Math.floor(size.height * 0.22) }], durationMs: duration };
    var activeDriver = driver();
    if (!activeDriver || typeof activeDriver.swipe !== "function") return failure("DEPENDENCY_MISSING", "next live swipe unavailable");
    var result;
    try { result = activeDriver.swipe(gesture); }
    catch (error) { return failure("DRIVER_ERROR", String(error && error.message || error)); }
    if (stopped()) return stopResult();
    return result === true || result && result.success === true ? success(gesture) :
      failure(result && result.reason || "DRIVER_REJECTED", "next live swipe rejected");
  }
  return { openDouyin: openDouyin, openSearchEntry: openSearchEntry,
    setSearchKeyword: setSearchKeyword, submitSearch: submitSearch,
    openLiveTab: openLiveTab, openFirstLive: openFirstLive, nextLive: nextLive };
}

module.exports = { createCommentNavigation: createCommentNavigation };
