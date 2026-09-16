// 职责：视频养号的界面动作层——查找/点击抖音搜索与视频入口、派发贝塞尔滑动手势、校验页面上下文。
// 业务代码只通过本层触达原生 API 与平台 adapter。

var swipeGeometry = require("./video-warmup-swipe.js");

// 单次下滑最多派发 2 次贝塞尔手势；两次之间留出冷却，避免无障碍服务仍在处理上一个手势。
var SWIPE_DISPATCH_ATTEMPTS = 2;
var SWIPE_RETRY_BACKOFF_MS = 400;
var NODE_QUERY_TIMEOUT_MS = 1500;
var NODE_QUERY_POLL_MS = 120;
var MAX_TAB_NODES = 20;

function createDefaultUi() {
  var options = arguments[0] || {};
  var context = options.context || {};
  var douyin = context.douyin || {};
  var logger = options.logger || context.logger || {};
  var wait = options.wait || context.sleep || function (delayMs) {
    if (typeof sleep === "function") sleep(delayMs);
  };
  var random = options.random || function (min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  };

  function screenSize() {
    if (typeof options.screenSize === "function") return options.screenSize();
    return {
      width: Math.max(1, Number(typeof device !== "undefined" && device.width || 1080)),
      height: Math.max(1, Number(typeof device !== "undefined" && device.height || 2400))
    };
  }

  function findFirst(selectors, predicate, timeoutMs) {
    var deadline = Date.now() + Math.max(0, Number(timeoutMs) || NODE_QUERY_TIMEOUT_MS);
    while (Date.now() <= deadline) {
      for (var i = 0; i < selectors.length; i++) {
        try {
          var selector = selectors[i];
          var node = selector && selector.findOnce && selector.findOnce();
          if (node && (!predicate || predicate(node))) return node;
        } catch (error) {}
      }
      wait(NODE_QUERY_POLL_MS);
    }
    return null;
  }

  function clickNode(node) {
    var current = node;
    for (var i = 0; i < 5 && current; i++) {
      try { if (current.clickable && current.clickable() && current.click()) return true; } catch (error) {}
      try { current = current.parent && current.parent(); } catch (parentError) { current = null; }
    }
    try {
      var bounds = node && node.bounds && node.bounds();
      return !!(bounds && typeof click === "function" && click(bounds.centerX(), bounds.centerY()));
    } catch (clickError) { return false; }
  }

  function clickPoint(xRatio, yRatio) {
    var size = screenSize();
    return typeof click === "function" && !!click(
      Math.floor(size.width * xRatio),
      Math.floor(size.height * yRatio)
    );
  }

  function openSearchEntry() {
    var selectors = [];
    try { selectors.push(desc("搜索")); } catch (error) {}
    try { selectors.push(descContains("搜索")); } catch (error2) {}
    try { selectors.push(text("搜索")); } catch (error3) {}
    var size = screenSize();
    var node = findFirst(selectors, function (candidate) {
      var bounds = candidate.bounds && candidate.bounds();
      return bounds && bounds.centerX() >= size.width * 0.65 && bounds.centerY() <= size.height * 0.20;
    });
    return node ? clickNode(node) : clickPoint(0.90, 0.075);
  }

  function findSearchInput() {
    var selectors = [];
    try { selectors.push(className("android.widget.EditText")); } catch (error) {}
    try { selectors.push(idContains("et_search")); } catch (error2) {}
    try { selectors.push(idContains("search_edit")); } catch (error3) {}
    try { selectors.push(descContains("搜索框")); } catch (error4) {}
    return findFirst(selectors);
  }

  function setSearchKeyword(keyword) {
    var inputNode = findSearchInput();
    if (!inputNode) return false;
    clickNode(inputNode);
    try { if (inputNode.setText && inputNode.setText(keyword) !== false) return true; } catch (error) {}
    try { if (typeof setText === "function") { setText(keyword); return true; } } catch (globalError) {}
    return false;
  }

  function submitSearch() {
    var selectors = [];
    try { selectors.push(text("搜索")); } catch (error) {}
    try { selectors.push(desc("搜索")); } catch (error2) {}
    var size = screenSize();
    var node = findFirst(selectors, function (candidate) {
      var bounds = candidate.bounds && candidate.bounds();
      return bounds && bounds.centerX() >= size.width * 0.72 && bounds.centerY() <= size.height * 0.20;
    });
    return node ? clickNode(node) : clickPoint(0.90, 0.08);
  }

  function findVideoTab(minYRatio, maxYRatio) {
    var selectors = [];
    try { selectors.push(text("视频")); } catch (error) {}
    try { selectors.push(desc("视频")); } catch (error2) {}
    var size = screenSize();
    var deadline = Date.now() + NODE_QUERY_TIMEOUT_MS;
    while (Date.now() <= deadline) {
      for (var selectorIndex = 0; selectorIndex < selectors.length; selectorIndex++) {
        var selector = selectors[selectorIndex];
        if (!selector || typeof selector.findOnce !== "function") continue;
        for (var nodeIndex = 0; nodeIndex < MAX_TAB_NODES; nodeIndex++) {
          try {
            var node = selector.findOnce(nodeIndex);
            if (!node) break;
            var bounds = node.bounds && node.bounds();
            if (!bounds) continue;
            var centerYRatio = bounds.centerY() / size.height;
            if (centerYRatio >= minYRatio && centerYRatio <= maxYRatio) return node;
          } catch (findError) { break; }
        }
      }
      wait(NODE_QUERY_POLL_MS);
    }
    return null;
  }

  function openUpperVideoTab() {
    var node = findVideoTab(0.10, 0.17);
    return node ? clickNode(node) : clickPoint(0.27, 0.135);
  }

  function openLowerVideoTab() {
    var node = findVideoTab(0.17, 0.24);
    return node ? clickNode(node) : clickPoint(0.61, 0.19);
  }

  function openFirstVideo() {
    return clickPoint(0.265, 0.38);
  }

  // 首选路径：无障碍服务派发贝塞尔手势。
  function dispatchBezier(coordinates) {
    var accessibility = context.accessibility;
    if (!accessibility || typeof accessibility.createGestureDriver !== "function") {
      return { accepted: false, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" };
    }
    try {
      var driver = accessibility.createGestureDriver();
      if (!driver || typeof driver.swipe !== "function") {
        return { accepted: false, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" };
      }
      var result = driver.swipe({
        points: [coordinates.start, coordinates.end],
        controlPoints: coordinates.controlPoints,
        durationMs: coordinates.durationMs
      });
      if (result && result.success === true) return { accepted: true, reason: "" };
      return {
        accepted: false,
        reason: String(result && result.reason || "ACCESSIBILITY_GESTURE_RESULT_INVALID"),
        message: result && result.message ? String(result.message) : ""
      };
    } catch (error) {
      return { accepted: false, reason: "ACCESSIBILITY_GESTURE_FAILED", message: String(error) };
    }
  }

  // 只派发贝塞尔曲线：派发被拒（服务繁忙、上一个手势未完）属于瞬时状态，重试同一手法的贝塞尔路径，
  // 不降级到平台或全局直线滑动——直线轨迹是被明确否决的形态，也让失败保持可见。
  function nextVideo() {
    var attempt = { accepted: false, reason: "ACCESSIBILITY_GESTURE_UNAVAILABLE" };
    var attempts = 0;
    var coordinates, details;
    for (var attemptIndex = 0; attemptIndex < SWIPE_DISPATCH_ATTEMPTS; attemptIndex++) {
      if (attemptIndex > 0) wait(SWIPE_RETRY_BACKOFF_MS);
      coordinates = swipeGeometry.videoSwipeCoordinates(screenSize(), random);
      details = {
        actionSignature: swipeGeometry.SWIPE_ACTION_SIGNATURE,
        start: coordinates.start,
        end: coordinates.end,
        controlPoints: coordinates.controlPoints,
        durationMs: coordinates.durationMs,
        dispatchAccepted: false,
        path: "",
        reason: "",
        attempts: attemptIndex + 1
      };
      attempts = attemptIndex + 1;
      attempt = dispatchBezier(coordinates);
      if (attempt.accepted) break;
      details.reason = attempt.reason;
      if (attempt.message) details.message = attempt.message;
    }
    if (attempt.accepted) {
      details.dispatchAccepted = true;
      details.path = "accessibility_bezier";
      if (logger.info) logger.info("视频养号贝塞尔手势派发已接受", details);
      return { accepted: true, path: details.path, reason: "", attempts: attempts, details: details };
    }
    if (logger.warn) logger.warn("视频养号贝塞尔手势派发失败", details);
    return { accepted: false, path: "", reason: details.reason, attempts: attempts, details: details };
  }

  function verifyVideoContext() {
    if (typeof douyin.isForeground === "function") {
      try {
        if (douyin.isForeground() === false) return { ok: false, reason: "DOUYIN_NOT_FOREGROUND" };
      } catch (error) {
        return { ok: true, reason: "FOREGROUND_PROBE_ERROR" };
      }
    }
    if (typeof douyin.isLiveRoomVisible === "function") {
      try {
        if (douyin.isLiveRoomVisible() === true) return { ok: false, reason: "LIVE_ROOM_ENTERED" };
      } catch (error) {
        return { ok: true, reason: "LIVE_ROOM_PROBE_ERROR" };
      }
    }
    return { ok: true, reason: "" };
  }

  function recoverVideoContext() {
    if (typeof douyin.recover !== "function") return false;
    try {
      douyin.recover("video");
      return true;
    } catch (error) {
      return false;
    }
  }

  return {
    openSearchEntry: openSearchEntry,
    setSearchKeyword: setSearchKeyword,
    submitSearch: submitSearch,
    openUpperVideoTab: openUpperVideoTab,
    openLowerVideoTab: openLowerVideoTab,
    openFirstVideo: openFirstVideo,
    nextVideo: nextVideo,
    verifyVideoContext: verifyVideoContext,
    recoverVideoContext: recoverVideoContext
  };
}

module.exports = {
  createDefaultUi: createDefaultUi,
  NODE_QUERY_TIMEOUT_MS: NODE_QUERY_TIMEOUT_MS
};
