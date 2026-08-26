// AutoJS adapter for the live-comment entry state machine.
function loadLiveCommentDependency(context, path, fallback) {
  if (context && context.forceBaselineLiveCommentEntry && typeof context.loadBaselineScript === "function") {
    return context.loadBaselineScript(path);
  }
  if (context && typeof context.loadBizScript === "function") {
    return context.loadBizScript(path);
  }
  return fallback();
}

function clickableNode(node) {
  var target = node;
  for (var index = 0; index < 5 && target; index++) {
    try { if (target.clickable && target.clickable()) return target; } catch (error) {}
    try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
  }
  return node;
}

function createDeferredGestureDriver(accessibility) {
  function call(method, input) {
    var driver;
    try { driver = accessibility.createGestureDriver(); } catch (error) {
      return { success: false, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE", message: String(error) };
    }
    if (!driver || typeof driver[method] !== "function") {
      return { success: false, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" };
    }
    return driver[method](input);
  }
  return {
    tap: function (input) { return call("tap", input); },
    swipe: function (input) { return call("swipe", input); }
  };
}

function createDefaultRuntime(context, fastSearch, options) {
  context = context || {};
  options = options || {};
  var commentCapture = loadLiveCommentDependency(context,
    "domain/live-comment-capture.js",
    function () { return require("../../domain/live-comment-capture.js"); });
  var accessibility = loadLiveCommentDependency(context,
    "core/accessibility.js",
    function () { return require("../../core/accessibility.js"); });
  var fastSearchModule = loadLiveCommentDependency(context,
    "features/account-warmup/fast-target-search.js",
    function () { return require("./fast-target-search.js"); });
  var gestureMode = options.gestureMode === "accessibility" || !!context.gestureDriver;
  var douyin = context.douyin || {};
  var riskDetector = context.riskDetector || {};
  var viewerCountParser = context.viewerCountParser || {};
  var screenRecognizer = context.screenRecognizer || {};
  var gestureDriver = context.gestureDriver || (gestureMode ? createDeferredGestureDriver(accessibility) : {});
  var liveCommentSearch = gestureMode && (fastSearch && fastSearch.gestureAware
    ? fastSearch
    : fastSearchModule.createFastTargetSearch({
    logger: context.logger,
    gestureDriver: gestureDriver
  }));
  var screenSize = function () {
    if (typeof device !== "undefined" && device && Number(device.width) > 0 && Number(device.height) > 0) {
      return { width: Number(device.width), height: Number(device.height) };
    }
    if (context.screenSize) return context.screenSize();
    return { width: 1080, height: 2400 };
  };

  function liveRoomOcrRegions() {
    var size = screenSize();
    return {
      liveEndedBanner: {
        x: Math.floor(size.width * 0.32),
        y: Math.floor(size.height * 0.06),
        w: Math.ceil(size.width * 0.38),
        h: Math.ceil(size.height * 0.055)
      },
      viewerBadge: {
        x: Math.floor(size.width * 0.595),
        y: Math.floor(size.height * 0.06),
        w: Math.ceil(size.width * 0.32),
        h: Math.ceil(size.height * 0.057)
      }
    };
  }

  function readComments() {
    if (!screenRecognizer.extractScreen) return { text: "", source: "commentArea" };
    var snapshot = screenRecognizer.extractScreen(commentCapture.commentOcrRegions(screenSize()));
    var regions = snapshot && snapshot.ocrRegions || {};
    var text = String(regions.commentArea || "");
    try { if (snapshot && snapshot.image && snapshot.image.recycle) snapshot.image.recycle(); } catch (error) {}
    return { text: text, source: "commentArea" };
  }

  function swipeComments() {
    var coordinates = commentCapture.commentSwipeCoordinates(screenSize());
    if (!gestureDriver || typeof gestureDriver.swipe !== "function") {
      if (!gestureMode && typeof swipe === "function") {
        return swipe(coordinates.startX, coordinates.startY, coordinates.endX, coordinates.endY, coordinates.durationMs) !== false;
      }
      return { success: false, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" };
    }
    var result = gestureDriver.swipe({
      points: [
        { x: coordinates.startX, y: coordinates.startY },
        { x: coordinates.endX, y: coordinates.endY }
      ],
      durationMs: coordinates.durationMs
    });
    return result === false || result && result.success === false
      ? result || { success: false, reason: "ACCESSIBILITY_GESTURE_FAILED" }
      : true;
  }

  function nodeCenter(node) {
    try {
      var bounds = node && node.bounds;
      bounds = typeof bounds === "function" ? bounds.call(node) : bounds;
      if (!bounds) return null;
      var x = typeof bounds.centerX === "function" ? bounds.centerX() : (Number(bounds.left) + Number(bounds.right)) / 2;
      var y = typeof bounds.centerY === "function" ? bounds.centerY() : (Number(bounds.top) + Number(bounds.bottom)) / 2;
      return isFinite(x) && isFinite(y) ? { x: x, y: y } : null;
    } catch (error) {
      return null;
    }
  }

  function tapPoint(x, y) {
    if (!gestureDriver || typeof gestureDriver.tap !== "function") return false;
    var result = gestureDriver.tap({ x: x, y: y, durationMs: 180 });
    return result !== false && !(result && result.success === false);
  }

  function tapNode(node) {
    var point = nodeCenter(node);
    return point ? tapPoint(point.x, point.y) : false;
  }

  function selectorNodes(selector) {
    var found = [];
    try {
      if (!selector) return found;
      if (selector.find) {
        var collection = selector.find();
        var count = typeof collection.length === "number" ? collection.length : collection.size ? collection.size() : 0;
        for (var index = 0; index < count; index += 1) {
          found.push(typeof collection.get === "function" ? collection.get(index) : collection[index]);
        }
      } else if (selector.findOne) {
        var one = selector.findOne(3000);
        if (one) found.push(one);
      }
    } catch (error) {}
    return found;
  }

  var waitRandom = function (min, max) {
    var delay = Math.floor(Number(min || 0) + Math.random() * (Number(max || min || 0) - Number(min || 0) + 1));
    if (typeof sleep === "function") sleep(delay);
    return delay;
  };

  var runtime = {
    openDouyin: function () { return douyin.openApp ? douyin.openApp() : false; },
    openSearch: function (keyword, control) {
      if (!gestureMode) {
        if (fastSearch && fastSearch.openSearch) return fastSearch.openSearch(keyword, control);
        return douyin.openSearch ? douyin.openSearch(keyword) : false;
      }
      return liveCommentSearch && liveCommentSearch.openSearch
        ? liveCommentSearch.openSearch(keyword, control)
        : false;
    },
    openLiveTab: function () {
      if (!gestureMode && douyin.openLiveTab) return douyin.openLiveTab();
      var size = screenSize();
      var selectors = [];
      try { if (typeof text === "function") selectors.push(text("直播")); } catch (textError) {}
      try { if (typeof desc === "function") selectors.push(desc("直播")); } catch (descError) {}
      for (var selectorIndex = 0; selectorIndex < selectors.length; selectorIndex++) {
        var selector = selectors[selectorIndex];
        var nodes = [];
        try {
          nodes = selectorNodes(selector);
        } catch (findError) {}
        for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
          var node = nodes[nodeIndex];
          var bounds = null;
          try { bounds = node && node.bounds && node.bounds(); } catch (boundsError) { bounds = null; }
          if (!bounds || typeof bounds.centerY !== "function" || bounds.centerY() > size.height * 0.38) continue;
          if (gestureMode) {
            if (tapNode(node)) return true;
          } else {
            var target = clickableNode(node);
            try { if (target && target.click && target.click()) return true; } catch (clickError) {}
            try { if (typeof click === "function" && click(bounds.centerX(), bounds.centerY())) return true; } catch (fallbackError) {}
          }
        }
      }
      return false;
    },
    openFirstLive: function () {
      if (!gestureMode && douyin.openFirstLive) {
        var opened = douyin.openFirstLive();
        if (opened === false) return { success: false, reason: "CLICK_FAILED" };
        return opened;
      }
      if (douyin.findFirstLive) {
        var firstLive = douyin.findFirstLive();
        if (!firstLive) return { success: false, reason: "NO_RESULT" };
        if (gestureMode && tapNode(firstLive)) return true;
        if (!gestureMode) {
          var firstTarget = clickableNode(firstLive);
          try { if (firstTarget && firstTarget.click && firstTarget.click()) return true; } catch (firstClickError) {}
          try {
            var firstBounds = firstLive.bounds && firstLive.bounds();
            if (firstBounds && typeof click === "function" && click(firstBounds.centerX(), firstBounds.centerY())) return true;
          } catch (firstFallbackError) {}
        }
        return { success: false, reason: "CLICK_FAILED" };
      }
      var size = screenSize();
      if (!gestureMode && typeof click === "function") {
        return click(Math.floor(size.width * 0.36), Math.floor(size.height * 0.35))
          ? true
          : { success: false, reason: "CLICK_FAILED" };
      }
      return tapPoint(Math.floor(size.width * 0.36), Math.floor(size.height * 0.35))
        ? true
        : { success: false, reason: "CLICK_FAILED" };
    },
    isLiveRoom: function () { return !!(douyin.isLiveRoomVisible && douyin.isLiveRoomVisible()); },
    readViewerCount: function () {
      if (!screenRecognizer.extractScreen) {
        return {
          count: null,
          ended: false,
          source: "viewerBadge",
          textSample: "OCR_UNAVAILABLE",
          endedTextSample: "OCR_UNAVAILABLE"
        };
      }
      var snapshot = screenRecognizer.extractScreen(liveRoomOcrRegions());
      var regions = snapshot && snapshot.ocrRegions || {};
      var badgeText = String(regions.viewerBadge || "").trim();
      var endedText = String(regions.liveEndedBanner || "").trim();
      try { if (snapshot && snapshot.image && snapshot.image.recycle) snapshot.image.recycle(); } catch (error) {}
      var ended = endedText.replace(/\s/g, "").indexOf("直播已结束") >= 0;
      var count = viewerCountParser.parseViewerBadgeCount
        ? viewerCountParser.parseViewerBadgeCount(badgeText)
        : null;
      return {
        count: count !== null && count !== undefined && isFinite(Number(count)) ? Number(count) : null,
        ended: ended,
        source: "viewerBadge",
        textSample: badgeText.slice(0, 260),
        endedTextSample: endedText.slice(0, 260)
      };
    },
    nextLive: function () {
      if (!gestureMode) return douyin.nextVideo ? douyin.nextVideo() : false;
      var coordinates = commentCapture.liveRoomSwipeCoordinates(screenSize());
      if (!gestureDriver || typeof gestureDriver.swipe !== "function") {
        return { success: false, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" };
      }
      var result = gestureDriver.swipe({
        points: [
          { x: coordinates.startX, y: coordinates.startY },
          { x: coordinates.endX, y: coordinates.endY }
        ],
        durationMs: coordinates.durationMs
      });
      return result === false || result && result.success === false
        ? result || { success: false, reason: "ACCESSIBILITY_GESTURE_FAILED" }
        : true;
    },
    detectPlatformVerification: function () {
      if (!douyin.extractFastText || !riskDetector.detectRisk) return { detected: false };
      var snapshot = douyin.extractFastText();
      var extractedText = String(snapshot && snapshot.combinedText || "");
      var detection = riskDetector.detectRisk(context.config || {}, extractedText);
      if (!detection || !detection.detected || detection.reasonCode !== "PLATFORM_VERIFICATION") {
        return { detected: false };
      }
      return {
        detected: true,
        reasonCode: detection.reasonCode,
        message: detection.message,
        textSample: extractedText
      };
    },
    waitRandom: waitRandom,
    restartSearch: function (keyword, control) {
      if (!gestureMode) {
        var legacyFastResult = fastSearch && fastSearch.openSearch
          ? fastSearch.openSearch(keyword, control)
          : false;
        if (legacyFastResult && legacyFastResult.stopped) return legacyFastResult;
        if (legacyFastResult !== false && !(legacyFastResult && legacyFastResult.success === false)) return legacyFastResult;
        return douyin.openSearch ? douyin.openSearch(keyword) : legacyFastResult;
      }
      var fastResult = liveCommentSearch && liveCommentSearch.openSearch
        ? liveCommentSearch.openSearch(keyword, control)
        : false;
      if (fastResult && fastResult.stopped) return fastResult;
      if (fastResult !== false && !(fastResult && fastResult.success === false)) return fastResult;
      return fastResult;
    }
  };

  if (screenRecognizer.extractScreen && (gestureMode || context.gestureDriver || typeof swipe === "function")) {
    runtime.readComments = readComments;
    runtime.swipeComments = swipeComments;
  }
  return runtime;
}

module.exports = {
  createDefaultRuntime: createDefaultRuntime
};
