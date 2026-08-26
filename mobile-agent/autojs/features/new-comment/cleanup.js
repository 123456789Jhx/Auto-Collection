"use strict";

var layout = require("./douyin-layout.js");
var createGestureActions = require("./gesture-actions.js").createGestureActions;
var defaultAccessibility = require("../../core/accessibility.js");

function createIsolatedCleanup(context, options) {
  context = context || {};
  options = options || {};
  var cachedResult = null;
  var lifecycleCalled = false;
  var gestureDriver = options.gestureDriver || context.gestureDriver || null;

  function screenSize() {
    var source;
    try {
      source = typeof options.screenSize === "function" ? options.screenSize() : options.screenSize;
      if (!source && typeof context.screenSize === "function") source = context.screenSize();
      if (!source && typeof device !== "undefined" && device) source = { width: device.width, height: device.height };
    } catch (error) {}
    return layout.normalizeScreenSize(source);
  }

  function resolveDriver() {
    if (gestureDriver) return gestureDriver;
    var accessibility = options.accessibility || context.accessibility || defaultAccessibility;
    try { gestureDriver = accessibility.createGestureDriver(options.accessibilityOptions || {}); }
    catch (error) { gestureDriver = null; }
    return gestureDriver;
  }

  var gestures = createGestureActions({
    shouldStop: function () { return false; },
    screenSize: screenSize,
    random: function () { return 0; },
    sleep: function (milliseconds) {
      if (typeof options.wait === "function") return options.wait(milliseconds);
      if (typeof sleep === "function") return sleep(milliseconds);
      return true;
    },
    driver: {
      click: function (x, y) {
        var driver = resolveDriver();
        if (driver && typeof driver.tap === "function") return driver.tap({ x: x, y: y, durationMs: 180 });
        try { return typeof click === "function" ? click(x, y) : false; } catch (error) { return false; }
      },
      swipe: function (startX, startY, endX, endY, durationMs) {
        var driver = resolveDriver();
        if (driver && typeof driver.swipe === "function") return driver.swipe({
          points: [{ x: startX, y: startY }, { x: endX, y: endY }], durationMs: durationMs
        });
        try { return typeof swipe === "function" ? swipe(startX, startY, endX, endY, durationMs) : false; }
        catch (error) { return false; }
      }
    }
  }, layout);

  function wait(milliseconds, skip) {
    if (skip || milliseconds <= 0) return;
    try {
      if (typeof options.wait === "function") options.wait(milliseconds);
      else if (typeof sleep === "function") sleep(milliseconds);
    } catch (error) {}
  }

  function selectorFind(pattern, timeoutMs) {
    var selectors = [];
    try { if (typeof textMatches === "function") selectors.push(textMatches(pattern)); } catch (error) {}
    try { if (typeof descMatches === "function") selectors.push(descMatches(pattern)); } catch (error) {}
    var index;
    for (index = 0; index < selectors.length; index += 1) {
      try {
        var node = selectors[index].findOne(Math.max(0, Number(timeoutMs) || 0));
        if (node) return node;
      } catch (error) {}
    }
    return null;
  }

  function cardBounds(node) {
    var target = node;
    var size = screenSize();
    var level;
    for (level = 0; level < 6 && target; level += 1) {
      try {
        var bounds = typeof target.bounds === "function" ? target.bounds() : target.bounds;
        if (bounds) {
          var left = typeof bounds.left === "function" ? bounds.left() : Number(bounds.left);
          var right = typeof bounds.right === "function" ? bounds.right() : Number(bounds.right);
          var top = typeof bounds.top === "function" ? bounds.top() : Number(bounds.top);
          var bottom = typeof bounds.bottom === "function" ? bounds.bottom() : Number(bounds.bottom);
          if (isFinite(left) && isFinite(right) && isFinite(top) && isFinite(bottom) &&
              right - left >= size.width * 0.25 && bottom - top >= size.height * 0.08) {
            return { left: left, right: right, top: top, bottom: bottom };
          }
        }
      } catch (error) {}
      try { target = typeof target.parent === "function" ? target.parent() : null; }
      catch (parentError) { target = null; }
    }
    return null;
  }

  var adapters = {
    isDouyinForeground: options.isDouyinForeground || function () {
      try {
        return typeof currentPackage === "function" &&
          String(currentPackage() || "") === String(options.douyinPackageName || "com.ss.android.ugc.aweme");
      } catch (error) { return false; }
    },
    openRecents: options.openRecents || function () {
      try { if (typeof recents === "function") { recents(); return true; } } catch (error) {}
      return false;
    },
    findDouyinCard: options.findDouyinCard || function (timeout) { return selectorFind(/.*抖音.*/, timeout); },
    findCenteredTaskCard: options.findCenteredTaskCard || function () {
      if (typeof id !== "function") return null;
      var cards;
      try { cards = id("com.miui.home:id/task_view_thumbnail").find() || []; } catch (error) { return null; }
      var size = screenSize();
      var selected = null;
      var distance = Infinity;
      var index;
      for (index = 0; index < Number(cards.length || 0); index += 1) {
        var card = typeof cards.get === "function" ? cards.get(index) : cards[index];
        var bounds = cardBounds(card);
        if (bounds) {
          var candidateDistance = Math.abs((bounds.left + bounds.right) / 2 - size.width / 2);
          if (candidateDistance < distance) { selected = card; distance = candidateDistance; }
        }
      }
      return selected;
    },
    dismissCard: options.dismissCard || function (card) {
      var bounds = cardBounds(card);
      if (!bounds) return false;
      var size = screenSize();
      return gestures.swipe("left", { ratios: { startX: (bounds.left + (bounds.right - bounds.left) * 0.8) / size.width,
        startY: ((bounds.top + bounds.bottom) / 2) / size.height,
        endX: (bounds.left + (bounds.right - bounds.left) * 0.1) / size.width,
        endY: ((bounds.top + bounds.bottom) / 2) / size.height }, durationMs: 420 }).success;
    },
    findAgentCard: options.findAgentCard || function (timeout) { return selectorFind(/.*燎原星火.*/, timeout); },
    openAgentCard: options.openAgentCard || function (card) { return gestures.click(card).success; },
    goHome: options.goHome || function () {
      try { if (typeof home === "function") { home(); return true; } } catch (error) {}
      return false;
    },
    findAgentHomeIcon: options.findAgentHomeIcon || function (timeout) { return selectorFind(/^燎原星火$/, timeout); },
    openAgentHomeIcon: options.openAgentHomeIcon || function (icon) { return gestures.click(icon).success; },
    openAgentByPackage: options.openAgentByPackage || function () {
      try {
        if (typeof app !== "undefined" && app && typeof app.launchPackage === "function") {
          return app.launchPackage(String(options.agentPackageName || "com.agri.video.collector")) !== false;
        }
        if (typeof app !== "undefined" && app && typeof app.launch === "function") return app.launch("燎原星火") !== false;
      } catch (error) {}
      return false;
    }
  };

  function safe(name, args, fallback) {
    try { return adapters[name].apply(adapters, args || []); } catch (error) { return fallback; }
  }

  function notify(lifecycle) {
    if (lifecycleCalled) return;
    lifecycleCalled = true;
    try { if (lifecycle && typeof lifecycle.beforeReturnToAgent === "function") lifecycle.beforeReturnToAgent(); }
    catch (error) {}
  }

  function stopRequested(payload, lifecycle) {
    var control = payload && payload.control || lifecycle && lifecycle.control;
    try { return !!(control && typeof control.shouldStop === "function" && control.shouldStop()); }
    catch (error) { return true; }
  }

  function fallback(reason, skipWait) {
    var returnedHome = safe("goHome", [], false) !== false;
    if (returnedHome) {
      wait(Math.max(0, Number(options.homeReadyWaitMs) || 0), skipWait);
      var icon = safe("findAgentHomeIcon", [Math.max(0, Number(options.findAgentHomeIconTimeoutMs) || 1000)], null);
      if (icon && safe("openAgentHomeIcon", [icon], false) !== false) {
        return { completed: true, fallback: "HOME_ICON", reason: reason };
      }
    }
    if (safe("openAgentByPackage", [], false) !== false) {
      return { completed: true, fallback: "PACKAGE", reason: reason };
    }
    return returnedHome ? { completed: true, fallback: "HOME", reason: reason } :
      { completed: false, reason: "HOME_FALLBACK_FAILED", cause: reason };
  }

  function cached() {
    var result = {};
    Object.keys(cachedResult || {}).forEach(function (key) { result[key] = cachedResult[key]; });
    result.cached = true;
    return result;
  }

  function run(payload, lifecycle) {
    if (cachedResult) return cached();
    payload = payload || {};
    var skipWait = stopRequested(payload, lifecycle);
    wait(Math.max(0, Number(options.cooldownMs) || 0), skipWait);
    var douyinWasForeground = safe("isDouyinForeground", [], false) === true;
    var opened = safe("openRecents", [], false) !== false;
    if (!opened) {
      notify(lifecycle);
      cachedResult = fallback("RECENTS_UNAVAILABLE", skipWait);
      return cachedResult;
    }
    wait(Math.max(0, Number(options.recentsReadyWaitMs) || 0), skipWait);
    var douyinCard = safe("findDouyinCard", [Math.max(0, Number(options.findCardTimeoutMs) || 1000)], null);
    if (!douyinCard && douyinWasForeground) douyinCard = safe("findCenteredTaskCard", [], null);
    var cleanupReason = "";
    if (!douyinCard) cleanupReason = "DOUYIN_RECENTS_CARD_NOT_FOUND";
    else if (safe("dismissCard", [douyinCard], false) === false) cleanupReason = "DOUYIN_RECENTS_DISMISS_FAILED";
    notify(lifecycle);
    wait(Math.max(0, Number(options.agentCardReadyWaitMs) || 0), skipWait);
    var agentCard = safe("findAgentCard", [Math.max(0, Number(options.findAgentCardTimeoutMs) || 1000)], null);
    if (!agentCard) cachedResult = fallback(cleanupReason || "AGENT_RECENTS_CARD_NOT_FOUND", skipWait);
    else if (safe("openAgentCard", [agentCard], false) === false) {
      cachedResult = fallback(cleanupReason || "AGENT_RECENTS_OPEN_FAILED", skipWait);
    } else cachedResult = cleanupReason ? { completed: true, cleanupReason: cleanupReason } : { completed: true };
    return cachedResult;
  }

  return { run: run };
}

module.exports = { createIsolatedCleanup: createIsolatedCleanup };
