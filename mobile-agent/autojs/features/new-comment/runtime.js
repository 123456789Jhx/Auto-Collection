"use strict";
var contract = require("../../core/action-contract.js");
var layout = require("./douyin-layout.js");
var commentCapture = require("./comment-capture.js");
var createGestureActions = require("../../core/gesture-actions.js").createGestureActions;
var createScreenActions = require("../../core/screen-actions.js").createScreenActions;
var defaultAccessibility = require("../../core/accessibility.js");
var cartDetector = require("./commerce-cart-detector.js");
var anchorProfile = require("./anchor-profile.js");
var commentWhiteFilter = require("./comment-white-filter.js");

function createIsolatedRuntime(context, options) {
  context = context || {};
  options = options || {};
  var control = options.control || {};
  var douyin = options.douyin || context.douyin || {};
  var recognizer = options.screenRecognizer || context.screenRecognizer || {};
  var riskDetector = options.riskDetector || context.riskDetector || {};
  var viewerParser = options.viewerCountParser || context.viewerCountParser || {};
  var logger = options.logger || context.logger || {};
  var imageApi = options.images || context.images || (typeof images !== "undefined" ? images : null);
  var fileApi = options.files || context.files || (typeof files !== "undefined" ? files : null);
  var captureScreenFn = options.captureScreen || context.captureScreen ||
    (typeof captureScreen !== "undefined" && typeof captureScreen === "function" ? captureScreen : null);
  var ocrEngine = options.ocrEngine || context.ocrEngine || {};
  var uploader = options.uploader || context.uploader || {};
  var commerceCartTemplate = options.commerceCartTemplate || context.commerceCartTemplate || null;
  var accessibility = options.accessibility || context.accessibility || defaultAccessibility;
  var traceLimit = Math.max(1, Math.min(100, Math.floor(Number(options.actionTraceLimit) || 40)));
  var actionTrace = [];
  var gestureDriver = options.gestureDriver || context.gestureDriver || null;
  var lastVerificationStructure = null;
  var lastVerificationText = "";

  function loadCommerceCartTemplate() {
    if (commerceCartTemplate || !imageApi || typeof imageApi.read !== "function" || !fileApi) return commerceCartTemplate;
    try {
      var root = typeof fileApi.cwd === "function" ? fileApi.cwd() : "";
      var path = typeof fileApi.join === "function" ? fileApi.join(root, "assets", "commerce-cart-template.png") : root + "/assets/commerce-cart-template.png";
      commerceCartTemplate = imageApi.read(path);
    } catch (error) {
      log("warn", "小黄车模板加载失败", { message: String(error && error.message || error) });
    }
    return commerceCartTemplate;
  }
  function detectCommerceCartFromScreenshot(region) {
    if (typeof captureScreenFn !== "function") return { detected: false, similarity: 0, reason: "SCREEN_CAPTURE_UNAVAILABLE" };
    var snapshot = null;
    try {
      snapshot = captureScreenFn();
      var image = snapshot && snapshot.image ? snapshot.image : snapshot;
      return cartDetector.matchCommerceCart(imageApi, image, loadCommerceCartTemplate(), region, 0.5);
    } catch (error) {
      return { detected: false, similarity: 0, reason: "SCREEN_CAPTURE_FAILED", message: String(error && error.message || error) };
    } finally {
      var imageToRecycle = snapshot && snapshot.image ? snapshot.image : snapshot;
      if (imageToRecycle && typeof imageToRecycle.recycle === "function") imageToRecycle.recycle();
    }
  }
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
  function log(level, message, details) {
    try { if (typeof logger[level] === "function") logger[level](message, details || {}); } catch (error) {}
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
    captureScreen: options.captureScreen || context.captureScreen ||
      (typeof captureScreen === "function" ? captureScreen : null),
    clipImage: function (image, region) {
      return imageApi && typeof imageApi.clip === "function" ? imageApi.clip(image,
        region.left, region.top, region.width, region.height) : null;
    },
    recognize: function (image, region) {
      if (typeof ocrEngine.recognize !== "function") throw new Error("ocr recognize unavailable");
      if (!region || region.name !== "commentArea") return ocrEngine.recognize(image);
      var filtered = commentWhiteFilter.preprocess(imageApi, image, options.commentWhiteFilter);
      if (!filtered.success) {
        log("error", "评论近白色文字过滤失败", {
          reason: filtered.reason,
          message: filtered.message || ""
        });
        throw new Error(filtered.reason + ": " + (filtered.message || "comment white filter failed"));
      }
      log("info", "评论近白色文字过滤完成", {
        minBrightness: filtered.minBrightness,
        maxSaturation: filtered.maxSaturation
      });
      try {
        return ocrEngine.recognize(filtered.image);
      } finally {
        var recycleFailure = recycleSnapshot(filtered.image);
        if (recycleFailure) throw new Error(recycleFailure.message);
      }
    },
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
    if (typeof douyin.clickFirstLiveByRandomArea === "function") return invoke(
      "openFirstLive", douyin, douyin.clickFirstLiveByRandomArea, [control], "CLICK_FAILED");
    if (typeof douyin.openFirstLive === "function") return invoke(
      "openFirstLive", douyin, douyin.openFirstLive, [], "CLICK_FAILED");
    if (typeof douyin.openLiveRoomFromCurrentScreen === "function") return invoke(
      "openFirstLive", douyin, douyin.openLiveRoomFromCurrentScreen,
      [undefined, { skipLiveRoomVerification: true }], "NO_RESULT");
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

  function readComments() {
    trace("readComments");
    if (stopped()) return contract.stopped();
    var region = commentCapture.commentOcrRegion(screenSize());
    log("info", "抓取评论词评论区 OCR 开始", { commentOcrExecuted: true, commentRegion: { x: region.x, y: region.y, width: region.w, height: region.h } });
    var captured = screens.captureRegions([{ name: "commentArea", left: region.x, top: region.y,
      width: region.w, height: region.h }]);
    if (!captured.success) { log("error", "抓取评论词评论区 OCR 失败", { commentOcrExecuted: false, reason: captured.reason || "CAPTURE_FAILED", message: captured.message || "" }); return captured; }
    var text = String(captured.value && captured.value[0] && captured.value[0].value || "");
    log("info", "抓取评论词评论区 OCR 完成", { commentOcrExecuted: true, commentTextRecognized: text.trim().length > 0, commentTextLength: text.length, commentLineCount: text.split(/\r?\n/).filter(function (line) { return line.trim(); }).length });
    var result = contract.success({
      text: text,
      source: "commentArea"
    });
    if (stopped()) return contract.stopped();
    return result;
  }

  function regionValue(name, outputName) {
    var region = layout.getRegion(name, screenSize());
    return { name: outputName, left: region.left, top: region.top,
      width: region.width, height: region.height };
  }
  function readViewerCount() {
    trace("readViewerCount");
    if (stopped()) return contract.stopped();
    var viewerRegion = regionValue("viewerCount", "viewerBadge");
    log("info", "抓取评论词旧 OCR 人数扫描开始", {
      legacyOcrStep: "viewer_count",
      viewerOcrExecuted: true,
      captureMode: "screen-region",
      viewerRegion: viewerRegion
    });
    var captured = screens.captureRegions([viewerRegion]);
    if (!captured.success) {
      log("error", "抓取评论词旧 OCR 人数扫描失败", {
        legacyOcrStep: "viewer_count",
        viewerOcrExecuted: false,
        reason: captured.reason,
        message: captured.message || ""
      });
      return captured;
    }
    var result;
    try {
      var values = captured.value || [];
      var badge = String(values[0] && values[0].value || "").trim();
      var endedText = "";
      var parser = typeof viewerParser === "function" ? viewerParser : viewerParser.parseViewerBadgeCount;
      var parserError = null;
      var count = null;
      try {
        count = typeof parser === "function" ? parser.call(viewerParser, badge) : null;
      } catch (error) {
        parserError = error;
      }
      log("info", "抓取评论词旧 OCR 人数扫描完成", {
        legacyOcrStep: "viewer_count",
        viewerOcrExecuted: true,
        viewerTextRecognized: badge.length > 0,
        viewerCountParsed: count !== null && count !== undefined && isFinite(Number(count)),
        viewerCount: count === null || count === undefined || !isFinite(Number(count)) ? null : Number(count),
        viewerRegion: viewerRegion,
        badgeText: badge
      });
      if (parserError) throw parserError;
      log("info", "抓取评论词人数 OCR 原始结果", { badgeText: badge, endedText: endedText, parsedCount: count });
      log("info", "抓取评论词 OCR 识别状态", {
        legacyOcrStep: "viewer_count",
        viewerOcrExecuted: true,
        viewerTextRecognized: badge.length > 0,
        viewerCountParsed: count !== null && count !== undefined && isFinite(Number(count)),
        viewerCount: count === null || count === undefined || !isFinite(Number(count)) ? null : Number(count),
        commerceCartScanExecuted: false
      });
      result = contract.success({
        count: count === null || count === undefined || !isFinite(Number(count)) ? null : Number(count),
        ended: /直播已结束|主播已下播/.test(endedText.replace(/\s/g, "")), source: "viewerBadge",
        textSample: badge.slice(0, 260), endedTextSample: endedText.slice(0, 260)
      });
    } catch (error) {
      log("error", "抓取评论词人数解析异常", { badgeText: badge, message: String(error && error.message || error) });
      result = contract.failure(contract.REASON.OCR_FAILED, String(error && error.message || error));
    }
    if (stopped()) return contract.stopped();
    return result;
  }

  function readCommerceCart() {
    trace("readCommerceCart");
    if (stopped()) return contract.stopped();
    var region = regionValue("commerceCart", "commerceCart");
    var match = detectCommerceCartFromScreenshot(region);
    if (match.reason && match.reason !== "MATCH_COMPLETED") {
      log("error", "抓取评论词小黄车检测失败", { commerceCartScanExecuted: false,
        reason: match.reason, message: match.message || "", commerceCartRegion: region });
      return contract.failure(contract.REASON.SCREEN_CAPTURE_FAILED, match.message || match.reason);
    }
    log("info", "抓取评论词小黄车检测完成", { commerceCartScanExecuted: true,
      commerceCartDetected: !!match.detected, commerceCartSimilarity: match.similarity,
      commerceCartRegion: region });
    return contract.success({ detected: !!match.detected, similarity: match.similarity,
      source: "commerceCartTemplate" });
  }

  function clickRegion(name, actionName) {
    trace(actionName);
    var region = layout.getRegion(name, screenSize());
    log("info", "抓取评论词主播身份动作开始", { action: actionName, region: region });
    var result = gestures.click({ bounds: {
      left: region.left,
      top: region.top,
      right: region.left + region.width,
      bottom: region.top + region.height
    } }, {
      jitterX: Math.floor((region.width - 1) / 2),
      jitterY: Math.floor((region.height - 1) / 2)
    });
    log(result && result.success === false ? "error" : "info", "抓取评论词主播身份动作完成", {
      action: actionName,
      success: !!(result && result.success),
      point: result && result.value
    });
    return result;
  }

  function openAnchorSummary() { return clickRegion("anchorHeaderTap", "openAnchorSummary"); }
  function openAnchorProfile() {
    var avatar = findNode({ method: "descContains", value: "的头像" });
    if (avatar) {
      trace("openAnchorProfile");
      log("info", "抓取评论词主播身份动作开始", { action: "openAnchorProfile", selector: "descContains:的头像" });
      var nodeResult = gestures.click(avatar);
      log(nodeResult && nodeResult.success === false ? "error" : "info", "抓取评论词主播身份动作完成", {
        action: "openAnchorProfile", success: !!(nodeResult && nodeResult.success),
        point: nodeResult && nodeResult.value, selector: "descContains:的头像"
      });
      return nodeResult;
    }
    return clickRegion("anchorSummaryProfileTap", "openAnchorProfile");
  }
  function closeAnchorProfile() { return clickRegion("anchorProfileBackTap", "closeAnchorProfile"); }

  function readRoomIdentity() {
    trace("readRoomIdentity");
    if (stopped()) return contract.stopped();
    var output = context.config && context.config.output || {};
    var result = anchorProfile.readAnchorProfile({
      captureScreen: captureScreenFn,
      images: imageApi,
      files: fileApi,
      ocrEngine: ocrEngine,
      screenSize: screenSize(),
      screenshotDir: options.profileScreenshotDir || output.screenshotDir || "",
      shouldStop: stopped,
      logger: logger
    });
    if (result.success) return contract.success(result.value);
    return contract.failure(result.reason || contract.REASON.OCR_FAILED,
      result.message || "anchor profile unavailable", result.details);
  }

  function swipeComments() {
    trace("swipeComments");
    if (stopped()) return contract.stopped();
    log("info", "评论区下滑并保持开始", { holdMs: 2000, coordinates: commentCapture.commentSwipeCoordinates(screenSize()) });
    var result = commentCapture.swipeAndCheckEnd({ driver: resolveGestureDriver(),
      screenSize: screenSize(), captureScreen: captureScreenFn, images: imageApi,
      ocrEngine: ocrEngine, shouldStop: stopped, sleep: sleepAdapter });
    log(result.success ? "info" : "error", "评论历史到底提示检查完成", result);
    return result;
  }
  function nextLive() {
    trace("nextLive");
    log("info", "抓取评论词动作开始", { action: "nextLive", source: "douyin.nextVideo" });
    if (stopped()) return contract.stopped();
    if (!douyin || typeof douyin.nextVideo !== "function") {
      var missing = contract.failure(contract.REASON.DEPENDENCY_MISSING, "douyin.nextVideo dependency missing");
      log("error", "抓取评论词动作完成", { action: "nextLive", source: "douyin.nextVideo", success: false, result: missing });
      return missing;
    }
    var raw;
    try { raw = douyin.nextVideo(); } catch (error) {
      var failed = contract.failure(contract.REASON.DRIVER_ERROR, String(error && error.message || error));
      log("error", "抓取评论词动作完成", { action: "nextLive", source: "douyin.nextVideo", success: false, result: failed });
      return failed;
    }
    if (stopped()) return contract.stopped();
    var result = raw === false || raw && raw.success === false
      ? contract.failure(raw && raw.reason || contract.REASON.DRIVER_REJECTED,
        raw && raw.message || "douyin.nextVideo failed")
      : raw && raw.success === true ? raw : contract.success(raw === undefined ? true : raw);
    log(result.success ? "info" : "error", "抓取评论词动作完成", {
      action: "nextLive", source: "douyin.nextVideo", success: result.success, result: result
    });
    return result;
  }
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
    readViewerCount: readViewerCount, readCommerceCart: readCommerceCart, nextLive: nextLive, readComments: readComments,
    openAnchorSummary: openAnchorSummary, openAnchorProfile: openAnchorProfile,
    readRoomIdentity: readRoomIdentity,
    closeAnchorProfile: closeAnchorProfile,
    swipeComments: swipeComments, detectPlatformVerification: detectPlatformVerification,
    waitRandom: waitRandom, getActionTrace: traceSnapshot };
}

module.exports = { createIsolatedRuntime: createIsolatedRuntime };
