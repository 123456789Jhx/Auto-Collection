"use strict";

var contract = require("./contract.js");
var layout = require("./douyin-layout.js");
var commentCapture = require("./comment-capture.js");
var createGestureActions = require("./gesture-actions.js").createGestureActions;
var createScreenActions = require("./screen-actions.js").createScreenActions;
var defaultAccessibility = require("../../core/accessibility.js");

function createIsolatedRuntime(context, options) {
  context = context || {};
  options = options || {};
  var control = options.control || {};
  var douyin = options.douyin || context.douyin || {};
  var recognizer = options.screenRecognizer || context.screenRecognizer || {};
  var riskDetector = options.riskDetector || context.riskDetector || {};
  var viewerParser = options.viewerCountParser || context.viewerCountParser || {};
  var accessibility = options.accessibility || context.accessibility || defaultAccessibility;
  var traceLimit = Math.max(1, Math.min(100, Math.floor(Number(options.actionTraceLimit) || 40)));
  var actionTrace = [];
  var gestureDriver = options.gestureDriver || context.gestureDriver || null;
  var lastVerificationStructure = null;
  var lastVerificationText = "";

  function stopped() {
    try {
      return !!(control && typeof control.shouldStop === "function" && control.shouldStop());
    } catch (error) {
      return true;
    }
  }

  function trace(name) {
    actionTrace.push(String(name));
    if (actionTrace.length > traceLimit) actionTrace.splice(0, actionTrace.length - traceLimit);
  }

  function traceSnapshot() {
    return actionTrace.slice(Math.max(0, actionTrace.length - traceLimit));
  }

  function screenSize() {
    var source;
    try {
      source = typeof options.screenSize === "function" ? options.screenSize() : options.screenSize;
      if (!source && typeof context.screenSize === "function") source = context.screenSize();
      if (!source && typeof device !== "undefined" && device) {
        source = { width: Number(device.width), height: Number(device.height) };
      }
    } catch (error) {}
    return layout.normalizeScreenSize(source);
  }

  function sleepAdapter(milliseconds) {
    if (typeof options.sleep === "function") return options.sleep(milliseconds);
    if (typeof context.sleep === "function") return context.sleep(milliseconds);
    if (typeof sleep === "function") return sleep(milliseconds);
    return false;
  }

  function randomAdapter(min, max) {
    if (typeof options.random === "function") return options.random(min, max);
    if (typeof context.random === "function") return context.random(min, max);
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function resolveGestureDriver() {
    if (gestureDriver) return gestureDriver;
    try {
      gestureDriver = accessibility && typeof accessibility.createGestureDriver === "function"
        ? accessibility.createGestureDriver(options.accessibilityOptions || {})
        : null;
    } catch (error) {
      gestureDriver = null;
    }
    return gestureDriver;
  }

  var gestures = createGestureActions({
    shouldStop: stopped,
    screenSize: screenSize,
    sleep: sleepAdapter,
    random: randomAdapter,
    driver: {
      click: function (x, y) {
        var driver = resolveGestureDriver();
        return driver && typeof driver.tap === "function"
          ? driver.tap({ x: x, y: y, durationMs: 180 })
          : { success: false, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" };
      },
      swipe: function (startX, startY, endX, endY, durationMs) {
        var driver = resolveGestureDriver();
        return driver && typeof driver.swipe === "function" ? driver.swipe({
          points: [{ x: startX, y: startY }, { x: endX, y: endY }],
          durationMs: durationMs
        }) : { success: false, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" };
      }
    }
  }, layout);

  function selectorFrom(description) {
    if (!description) return null;
    if (typeof options.createSelector === "function") return options.createSelector(description);
    try {
      if (description.method === "text" && typeof text === "function") return text(description.value);
      if (description.method === "desc" && typeof desc === "function") return desc(description.value);
      if (description.method === "textContains" && typeof textContains === "function") return textContains(description.value);
      if (description.method === "descContains" && typeof descContains === "function") return descContains(description.value);
      if (description.method === "textMatches" && typeof textMatches === "function") return textMatches(description.value);
      if (description.method === "className" && typeof className === "function") return className(description.value);
    } catch (error) {}
    return description;
  }

  function findNode(description) {
    if (typeof options.findNode === "function") return options.findNode(description);
    if (typeof context.findNode === "function") return context.findNode(description);
    var selector = selectorFrom(description);
    try {
      if (selector && typeof selector.findOne === "function") {
        return selector.findOne(Math.max(0, Number(options.selectorTimeoutMs) || 1000));
      }
    } catch (error) {}
    return null;
  }

  function extractFastText() {
    var extractor = options.extractFastText || recognizer.extractFastText || douyin.extractFastText;
    if (typeof extractor !== "function") return null;
    var owner = options.extractFastText ? options : (recognizer.extractFastText ? recognizer : douyin);
    return extractor.call(owner);
  }

  function riskMethod() {
    return typeof riskDetector === "function" ? riskDetector : riskDetector.detectRisk;
  }
  function stableDiagnosticValue(value, depth) {
    var type = typeof value;
    if (value === null || type === "boolean") return value;
    if (type === "string") return value.slice(0, 1000);
    if (type === "number") return isFinite(value) ? value : null;
    if (type !== "object" || depth <= 0) return undefined;
    if (Array.isArray(value)) {
      var values = [];
      value.slice(0, 20).forEach(function (item) {
        var safeItem = stableDiagnosticValue(item, depth - 1);
        if (safeItem !== undefined) values.push(safeItem);
      });
      return values;
    }
    var result = {};
    Object.keys(value).sort().slice(0, 30).forEach(function (key) {
      if (key === "image") return;
      var safeValue = stableDiagnosticValue(value[key], depth - 1);
      if (safeValue !== undefined) result[key] = safeValue;
    });
    return result;
  }
  function readVerificationSnapshot() {
    lastVerificationText = "";
    lastVerificationStructure = null;
    var snapshot = extractFastText();
    lastVerificationText = String(snapshot &&
      (snapshot.combinedText || snapshot.text || snapshot.visibleText) || "");
    var explicit = snapshot &&
      (snapshot.pageStructure || snapshot.visibleStructure || snapshot.structure);
    lastVerificationStructure = stableDiagnosticValue(explicit || snapshot, 4);
    return snapshot;
  }

  function recycleSnapshot(snapshot) {
    var image = snapshot && snapshot.image ? snapshot.image :
      (snapshot && typeof snapshot.recycle === "function" ? snapshot : null);
    if (!image) return null;
    try {
      if (typeof options.recycleImage === "function") options.recycleImage(image);
      else if (typeof image.recycle === "function") image.recycle();
      return null;
    } catch (error) {
      return contract.failure(contract.REASON.IMAGE_RECYCLE_FAILED, "image recycle failed");
    }
  }

  function detectRisk() {
    var detector = riskMethod();
    var snapshot = null;
    try {
      snapshot = readVerificationSnapshot();
      var found = detector.call(riskDetector, context.config || {}, lastVerificationText) || { detected: false };
      if (typeof found !== "object" || !found) return found;
      var copied = {};
      Object.keys(found).forEach(function (key) { copied[key] = found[key]; });
      copied.textSample = lastVerificationText.slice(0, 260);
      return copied;
    } finally {
      var recycleFailure = recycleSnapshot(snapshot);
      if (recycleFailure) throw new Error(recycleFailure.message);
    }
  }

  var screens = createScreenActions({
    shouldStop: stopped,
    findNode: findNode,
    now: function () { return Date.now(); },
    sleep: sleepAdapter,
    screenSize: screenSize,
    detectRisk: detectRisk,
    getPageStructure: function () { return lastVerificationStructure; },
    getActionTrace: traceSnapshot
  }, layout);

  function envelope(raw, reason, message) {
    if (raw && typeof raw.success === "boolean") return raw;
    if (raw === false || raw === null || typeof raw === "undefined") {
      return contract.failure(reason || contract.REASON.DRIVER_REJECTED, message || "action failed");
    }
    return contract.success(raw);
  }

  function invoke(name, owner, method, args, reason) {
    trace(name);
    if (stopped()) return contract.stopped();
    if (!owner || typeof method !== "function") {
      return contract.failure(contract.REASON.DEPENDENCY_MISSING, name + " dependency missing");
    }
    var raw;
    try { raw = method.apply(owner, args || []); } catch (error) {
      return contract.failure(contract.REASON.DRIVER_ERROR, String(error && error.message || error));
    }
    if (stopped()) return contract.stopped();
    return envelope(raw, reason, name + " failed");
  }

  function openDouyin() {
    return invoke("openDouyin", douyin, douyin.openApp || douyin.openDouyin || options.openDouyin, []);
  }

  function openSearch(keyword, activeControl) {
    var search = options.openSearch || (options.fastSearch && options.fastSearch.openSearch) || douyin.openSearch;
    var owner = options.openSearch ? options : (options.fastSearch && options.fastSearch.openSearch ? options.fastSearch : douyin);
    return invoke("openSearch", owner, search, [keyword, activeControl || control]);
  }

  function restartSearch(keyword, activeControl) {
    var restart = options.restartSearch || (options.fastSearch && options.fastSearch.openSearch) ||
      douyin.restartSearch || douyin.openSearch;
    var owner = options.restartSearch ? options : (options.fastSearch && options.fastSearch.openSearch
      ? options.fastSearch : douyin);
    return invoke("restartSearch", owner, restart, [keyword, activeControl || control]);
  }

  function openLiveTab() {
    if (typeof douyin.openLiveTab === "function") return invoke("openLiveTab", douyin, douyin.openLiveTab, []);
    trace("openLiveTab");
    var descriptions = layout.SELECTOR_DESCRIPTIONS.liveTab || [];
    var index;
    for (index = 0; index < descriptions.length; index += 1) {
      var found = screens.waitForNode(descriptions[index], Number(options.selectorTimeoutMs) || 0);
      if (found.reason === contract.REASON.STOP_REQUESTED) return found;
      if (found.success) return gestures.click(found.value);
    }
    return contract.failure(contract.REASON.NODE_TIMEOUT, "live tab not found");
  }

  function openFirstLive() {
    if (typeof douyin.openFirstLive === "function") {
      return invoke("openFirstLive", douyin, douyin.openFirstLive, [], "CLICK_FAILED");
    }
    if (typeof douyin.openLiveRoomFromCurrentScreen === "function") {
      return invoke("openFirstLive", douyin, douyin.openLiveRoomFromCurrentScreen, [], "CLICK_FAILED");
    }
    trace("openFirstLive");
    if (stopped()) return contract.stopped();
    var target = typeof douyin.findFirstLive === "function" ? douyin.findFirstLive() : null;
    if (!target) return contract.failure("NO_RESULT", "first live result not found");
    return gestures.click(target);
  }

  function isLiveRoom() {
    var method = douyin.isLiveRoomVisible || douyin.isLiveRoom || options.isLiveRoom;
    return invoke("isLiveRoom", douyin, method, []);
  }

  function extractScreen(regions) {
    var extractor = options.extractScreen || recognizer.extractScreen;
    if (typeof extractor !== "function") {
      return contract.failure(contract.REASON.DEPENDENCY_MISSING, "screen recognizer missing");
    }
    var owner = options.extractScreen ? options : recognizer;
    var snapshot;
    try { snapshot = extractor.call(owner, regions); } catch (error) {
      return contract.failure(contract.REASON.SCREEN_CAPTURE_FAILED, String(error && error.message || error));
    }
    return contract.success(snapshot);
  }

  function readComments() {
    trace("readComments");
    if (stopped()) return contract.stopped();
    var captured = extractScreen(commentCapture.commentOcrRegions(screenSize()));
    if (!captured.success) return captured;
    var snapshot = captured.value;
    var result = contract.success({
      text: String(snapshot && snapshot.ocrRegions && snapshot.ocrRegions.commentArea || ""),
      source: "commentArea"
    });
    var recycleFailure = recycleSnapshot(snapshot);
    if (stopped()) return contract.stopped();
    return recycleFailure || result;
  }

  function regionValue(name) {
    var region = layout.getRegion(name, screenSize());
    return { x: region.left, y: region.top, w: region.width, h: region.height };
  }

  function readViewerCount() {
    trace("readViewerCount");
    if (stopped()) return contract.stopped();
    var captured = extractScreen({ viewerBadge: regionValue("viewerCount"), liveEndedBanner: regionValue("liveEnded") });
    if (!captured.success) return captured;
    var snapshot = captured.value;
    var result;
    var recycleFailure;
    try {
      var regions = snapshot && snapshot.ocrRegions || {};
      var badge = String(regions.viewerBadge || "").trim();
      var endedText = String(regions.liveEndedBanner || "").trim();
      var parser = typeof viewerParser === "function" ? viewerParser : viewerParser.parseViewerBadgeCount;
      var count = typeof parser === "function" ? parser.call(viewerParser, badge) : null;
      result = contract.success({
        count: count === null || count === undefined || !isFinite(Number(count)) ? null : Number(count),
        ended: /直播已结束|主播已下播/.test(endedText.replace(/\s/g, "")), source: "viewerBadge",
        textSample: badge.slice(0, 260), endedTextSample: endedText.slice(0, 260)
      });
    } catch (error) {
      result = contract.failure(contract.REASON.OCR_FAILED, String(error && error.message || error));
    } finally {
      recycleFailure = recycleSnapshot(snapshot);
    }
    if (stopped()) return contract.stopped();
    return recycleFailure && result.success ? recycleFailure : result;
  }

  function swipeCoordinates(name, coordinates) {
    trace(name);
    var size = screenSize();
    return gestures.swipe("up", { ratios: { startX: coordinates.startX / size.width,
      startY: coordinates.startY / size.height, endX: coordinates.endX / size.width,
      endY: coordinates.endY / size.height }, durationMs: coordinates.durationMs });
  }

  function swipeComments() { return swipeCoordinates("swipeComments", commentCapture.commentSwipeCoordinates(screenSize())); }
  function nextLive() { return swipeCoordinates("nextLive", commentCapture.liveRoomSwipeCoordinates(screenSize())); }
  function waitRandom(min, max) { trace("waitRandom"); return gestures.waitRandom(min, max); }

  function detectPlatformVerification() {
    trace("detectPlatformVerification");
    if (stopped()) return contract.stopped();
    if (typeof riskMethod() !== "function") {
      var snapshot = null;
      var missing = contract.failure(contract.REASON.DEPENDENCY_MISSING,
        "platform verification detector missing");
      try { snapshot = readVerificationSnapshot(); } catch (error) {
        missing = contract.failure(contract.REASON.VERIFICATION_CHECK_FAILED,
          "verification diagnostics failed");
      }
      var recycleFailure = recycleSnapshot(snapshot);
      if (stopped()) return contract.stopped();
      if (recycleFailure) missing = contract.failure(contract.REASON.VERIFICATION_CHECK_FAILED,
        recycleFailure.message);
      missing.details = verificationDetails();
      return missing;
    }
    var result = screens.detectPlatformVerification();
    if (result && result.success && result.value) result.value = verificationDetails(result.value);
    else if (result) result.details = verificationDetails(result.details);
    return result;
  }

  function verificationDetails(details) {
    details = details || {};
    details.textSample = String(lastVerificationText || "").slice(0, 260);
    details.pageStructure = lastVerificationStructure;
    details.visibleStructure = lastVerificationStructure;
    details.actionTrace = traceSnapshot();
    return details;
  }

  return { openDouyin: openDouyin, openSearch: openSearch, restartSearch: restartSearch,
    openLiveTab: openLiveTab, openFirstLive: openFirstLive, isLiveRoom: isLiveRoom,
    readViewerCount: readViewerCount, nextLive: nextLive, readComments: readComments,
    swipeComments: swipeComments, detectPlatformVerification: detectPlatformVerification,
    waitRandom: waitRandom, getActionTrace: traceSnapshot };
}

module.exports = { createIsolatedRuntime: createIsolatedRuntime };
