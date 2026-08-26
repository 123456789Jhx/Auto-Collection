// 职责：以有界等待完成养号关键词搜索，不复用通用搜索的宽泛页面扫描。
function createFastTargetSearch(options) {
  options = options || {};
  var logger = options.logger || { info: function () {}, warn: function () {} };
  var gestureDriver = options.gestureDriver || null;
  var deps = options.dependencies || createDefaultDependencies(gestureDriver);
  if (gestureDriver && options.dependencies) deps = withGestureDependencies(deps, gestureDriver);

  function stopped(control) {
    return !!(control && control.shouldStop && control.shouldStop());
  }

  function waitFor(stage, finder, timeoutMs, control) {
    var deadline = deps.now() + timeoutMs;
    while (deps.now() <= deadline) {
      if (stopped(control)) return { stopped: true, stage: stage };
      var value = finder();
      if (value) return { value: value, stage: stage };
      deps.sleep(120);
    }
    return { value: null, stage: stage };
  }

  function logStage(stage, startedAt, stageStartedAt, extra) {
    var payload = extra || {};
    payload.stage = stage;
    payload.stageElapsedMs = deps.now() - stageStartedAt;
    payload.elapsedMs = deps.now() - startedAt;
    logger.info("养号快速搜索阶段完成", payload);
  }

  function failure(stage, startedAt, message) {
    logger.warn("养号快速搜索失败", {
      stage: stage,
      elapsedMs: deps.now() - startedAt,
      message: message
    });
    return { success: false, stage: stage, elapsedMs: deps.now() - startedAt, message: message };
  }

  function openSearch(keyword, control) {
    keyword = String(keyword || "").trim();
    var startedAt = deps.now();
    if (!keyword) return failure("keyword_invalid", startedAt, "target keyword is required");
    if (stopped(control)) return { success: false, stopped: true, stage: "before_search", elapsedMs: 0 };

    var stageStartedAt = deps.now();
    var entryResult = waitFor("entry_wait", deps.findSearchEntry, 1400, control);
    if (entryResult.stopped) return { success: false, stopped: true, stage: entryResult.stage, elapsedMs: deps.now() - startedAt };
    var entryOpened = entryResult.value
      ? deps.clickNode(entryResult.value)
      : deps.clickPoint(Math.floor(deps.screenSize().width * 0.90), Math.floor(deps.screenSize().height * 0.065));
    if (!entryOpened) return failure("entry_open", startedAt, "search entry click failed");
    deps.sleep(3000);
    logStage("entry_opened", startedAt, stageStartedAt, { source: entryResult.value ? "node" : "coordinate" });

    if (stopped(control)) return { success: false, stopped: true, stage: "input_wait", elapsedMs: deps.now() - startedAt };
    stageStartedAt = deps.now();
    var inputResult = waitFor("input_wait", deps.findInput, 1800, control);
    if (inputResult.stopped) return { success: false, stopped: true, stage: inputResult.stage, elapsedMs: deps.now() - startedAt };
    if (!inputResult.value) return failure("input_wait", startedAt, "search input not found");
    if (!deps.setInput(inputResult.value, keyword)) return failure("keyword_input", startedAt, "keyword input failed");
    deps.sleep(3000);
    logStage("keyword_entered", startedAt, stageStartedAt, { keyword: keyword });

    if (stopped(control)) return { success: false, stopped: true, stage: "submit_wait", elapsedMs: deps.now() - startedAt };
    stageStartedAt = deps.now();
    var submitResult = waitFor("submit_wait", deps.findSubmit, 900, control);
    if (submitResult.stopped) return { success: false, stopped: true, stage: submitResult.stage, elapsedMs: deps.now() - startedAt };
    var submitted = submitResult.value ? deps.clickNode(submitResult.value) : deps.pressEnter();
    if (!submitted) return failure("search_submit", startedAt, "search submit failed");
    deps.sleep(300);
    logStage("search_submitted", startedAt, stageStartedAt, { source: submitResult.value ? "node" : "enter" });

    if (stopped(control)) return { success: false, stopped: true, stage: "result_wait", elapsedMs: deps.now() - startedAt };
    stageStartedAt = deps.now();
    var result = waitFor("result_wait", function () { return deps.isResultFor(keyword); }, 4000, control);
    if (result.stopped) return { success: false, stopped: true, stage: result.stage, elapsedMs: deps.now() - startedAt };
    if (!result.value) return failure("result_wait", startedAt, "search result not confirmed");
    logStage("result_confirmed", startedAt, stageStartedAt, { keyword: keyword });
    return { success: true, stage: "result_confirmed", elapsedMs: deps.now() - startedAt };
  }

  return { openSearch: openSearch, gestureAware: !!gestureDriver };
}

function nodeCenter(node) {
  try {
    var bounds = node && node.bounds;
    bounds = typeof bounds === "function" ? bounds.call(node) : bounds;
    if (!bounds) return null;
    var centerX = typeof bounds.centerX === "function" ? bounds.centerX() : (Number(bounds.left) + Number(bounds.right)) / 2;
    var centerY = typeof bounds.centerY === "function" ? bounds.centerY() : (Number(bounds.top) + Number(bounds.bottom)) / 2;
    return isFinite(centerX) && isFinite(centerY) ? { x: centerX, y: centerY } : null;
  } catch (error) {
    return null;
  }
}

function gestureTap(driver, x, y) {
  if (!driver || typeof driver.tap !== "function") return false;
  var result = driver.tap({ x: x, y: y, durationMs: 180 });
  return result !== false && !(result && result.success === false);
}

function withGestureDependencies(base, driver) {
  var wrapped = {};
  Object.keys(base || {}).forEach(function (key) { wrapped[key] = base[key]; });
  wrapped.clickNode = function (node) {
    var point = nodeCenter(node);
    return point ? gestureTap(driver, point.x, point.y) : false;
  };
  wrapped.clickPoint = function (x, y) { return gestureTap(driver, x, y); };
  return wrapped;
}

function createDefaultDependencies(gestureDriver) {
  function now() { return Date.now(); }
  function sleepFor(ms) { if (typeof sleep === "function") sleep(ms); }
  function screenSize() {
    return {
      width: Math.max(1, Number(typeof device !== "undefined" && device.width || 1080)),
      height: Math.max(1, Number(typeof device !== "undefined" && device.height || 2400))
    };
  }
  function findFirst(selectors, predicate) {
    for (var i = 0; i < selectors.length; i++) {
      try {
        var node = selectors[i] && selectors[i].findOnce && selectors[i].findOnce();
        if (node && (!predicate || predicate(node))) return node;
      } catch (error) {}
    }
    return null;
  }
  function clickable(node) {
    var target = node;
    for (var i = 0; i < 5 && target; i++) {
      try { if (target.clickable && target.clickable()) return target; } catch (error) {}
      try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
    }
    return node;
  }
  function clickNode(node) {
    if (gestureDriver) {
      var point = nodeCenter(node);
      return point ? gestureTap(gestureDriver, point.x, point.y) : false;
    }
    var target = clickable(node);
    try { if (target && target.click && target.click()) return true; } catch (error) {}
    try {
      var bounds = node && node.bounds && node.bounds();
      return !!(bounds && typeof click === "function" && click(bounds.centerX(), bounds.centerY()));
    } catch (clickError) { return false; }
  }
  function searchEntry() {
    var size = screenSize();
    var selectors = [];
    try { selectors.push(desc("搜索")); } catch (error) {}
    try { selectors.push(descContains("搜索")); } catch (error2) {}
    try { selectors.push(text("搜索")); } catch (error3) {}
    return findFirst(selectors, function (node) {
      var bounds = node && node.bounds && node.bounds();
      return bounds && bounds.centerY() <= size.height * 0.20;
    });
  }
  function inputNode() {
    var selectors = [];
    try { selectors.push(className("android.widget.EditText")); } catch (error) {}
    try { selectors.push(idContains("et_search")); } catch (error2) {}
    try { selectors.push(descContains("搜索框")); } catch (error3) {}
    return findFirst(selectors);
  }
  function submitNode() {
    var size = screenSize();
    var selectors = [];
    try { selectors.push(text("搜索")); } catch (error) {}
    try { selectors.push(desc("搜索")); } catch (error2) {}
    return findFirst(selectors, function (node) {
      var bounds = node && node.bounds && node.bounds();
      return bounds && bounds.centerX() >= size.width * 0.72 && bounds.centerY() <= size.height * 0.20;
    });
  }
  function setInput(node, keyword) {
    try { clickNode(node); } catch (error) {}
    try { if (node && node.setText) return node.setText(keyword) !== false; } catch (setError) {}
    try { if (typeof setText === "function") { setText(keyword); return true; } } catch (globalError) {}
    return false;
  }
  function pressEnter() {
    if (gestureDriver) {
      var size = screenSize();
      return gestureTap(gestureDriver, Math.floor(size.width * 0.90), Math.floor(size.height * 0.065));
    }
    try { if (typeof shell === "function") { shell("input keyevent 66", false); return true; } } catch (error) {}
    return false;
  }
  function resultFor(keyword) {
    var keywordNode = null;
    var tabNode = null;
    try { keywordNode = textContains(keyword).findOnce(); } catch (error) {}
    var tabs = ["综合", "视频", "用户", "直播"];
    for (var i = 0; i < tabs.length && !tabNode; i++) {
      try { tabNode = text(tabs[i]).findOnce(); } catch (tabError) {}
    }
    return !!(keywordNode && tabNode);
  }
  return {
    now: now,
    sleep: sleepFor,
    screenSize: screenSize,
    findSearchEntry: searchEntry,
    findInput: inputNode,
    findSubmit: submitNode,
    clickNode: clickNode,
    clickPoint: function (x, y) {
      return gestureDriver ? gestureTap(gestureDriver, x, y) : typeof click === "function" && !!click(x, y);
    },
    setInput: setInput,
    pressEnter: pressEnter,
    isResultFor: resultFor
  };
}

module.exports = {
  createFastTargetSearch: createFastTargetSearch
};
