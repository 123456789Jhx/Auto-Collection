// 职责：仅完成抖音直播间进入，不读取评论或调用互动 runner。
function createLiveCommentEntryTask(options) {
  options = options || {};
  var runtime = options.runtime || createDefaultRuntime(options.context || {}, options.fastSearch);
  var reportStage = options.reportStage || function () {};

  function stopped(control) {
    return !!(control && control.shouldStop && control.shouldStop());
  }

  function stage(stageName, payload) {
    var event = payload || {};
    event.stage = stageName;
    reportStage(event);
  }

  function failure(failedStage, message) {
    stage("FAILED", { failedStage: failedStage, message: message });
    return {
      status: "LIVE_COMMENT_ENTRY_FAILED",
      failedStage: failedStage,
      message: message
    };
  }

  function isNoResult(value) {
    return value === false || !!(value && (
      value.reason === "NO_RESULT" ||
      value.noResult === true ||
      value.stage === "result_wait"
    ));
  }

  function call(name, failedStage, args, control) {
    if (stopped(control)) return { stopped: true };
    var result;
    try {
      result = runtime[name].apply(runtime, args || []);
    } catch (error) {
      return { failed: true, message: String(error && error.message || error) };
    }
    if (result && result.stopped) return { stopped: true };
    if (result === false || (result && result.success === false)) {
      return { failed: true, value: result, message: String(result && (result.message || result.stage) || failedStage) };
    }
    return { value: result };
  }

  function run(payload, control) {
    payload = payload || {};
    control = control || {};
    if (stopped(control)) return { status: "STOPPED" };
    var keyword = String(payload.targetKeyword || payload.keyword || "").trim();
    var attempt = 1;

    stage("OPENING_DOUYIN", { attempt: attempt });
    var result = call("openDouyin", "OPENING_DOUYIN", [], control);
    if (result.stopped) return { status: "STOPPED" };
    if (result.failed) return failure("OPENING_DOUYIN", result.message);
    if (runtime.waitRandom) runtime.waitRandom(7000, 7000);
    if (stopped(control)) return { status: "STOPPED" };

    while (attempt <= 2) {
      stage("OPENING_SEARCH", { attempt: attempt });
      stage("INPUT_KEYWORD", { attempt: attempt, keyword: keyword });
      result = call(attempt === 1 ? "openSearch" : "restartSearch", "OPENING_SEARCH", [keyword, control], control);
      if (result.stopped) return { status: "STOPPED" };
      if (result.failed) {
        var noResults = !!(result.value && result.value.stage === "result_wait");
        if (attempt === 1 && noResults) {
          stage("RETRYING_SEARCH", { attempt: 2, message: result.message });
          attempt = 2;
          continue;
        }
        return failure("OPENING_SEARCH", result.message);
      }
      if (runtime.waitRandom) runtime.waitRandom(300, 900);
      if (stopped(control)) return { status: "STOPPED" };

      stage("OPENING_LIVE_TAB", { attempt: attempt });
      result = call("openLiveTab", "OPENING_LIVE_TAB", [], control);
      if (result.stopped) return { status: "STOPPED" };
      if (result.failed) return failure("OPENING_LIVE_TAB", result.message);
      if (runtime.waitRandom) runtime.waitRandom(1000, 3000);

      stage("OPENING_FIRST_RESULT", { attempt: attempt });
      result = call("openFirstLive", "OPENING_FIRST_RESULT", [], control);
      if (result.stopped) return { status: "STOPPED" };
      if (result.failed) {
        if (attempt >= 2 || !isNoResult(result.value)) return failure("OPENING_FIRST_RESULT", result.message);
        stage("RETRYING_SEARCH", { attempt: 2, message: result.message });
        attempt = 2;
        continue;
      }

      if (runtime.waitRandom) runtime.waitRandom(1000, 3000);
      result = call("isLiveRoom", "OPENING_FIRST_RESULT", [], control);
      if (result.stopped) return { status: "STOPPED" };
      if (result.failed || !result.value) {
        return failure("OPENING_FIRST_RESULT", result.message || "LIVE_ROOM_NOT_READY");
      }

      if (stopped(control)) return { status: "STOPPED" };
      stage("ENTERED", { attempt: attempt });
      return { status: "LIVE_COMMENT_ENTRY_ENTERED" };
    }
    return failure("OPENING_FIRST_RESULT", "LIVE_ENTRY_NOT_FOUND");
  }

  return { run: run };
}

function createDefaultRuntime(context, fastSearch) {
  var douyin = context.douyin || {};
  var screenSize = function () {
    if (typeof device !== "undefined" && device && Number(device.width) > 0 && Number(device.height) > 0) {
      return { width: Number(device.width), height: Number(device.height) };
    }
    if (context.screenSize) return context.screenSize();
    return { width: 1080, height: 2400 };
  };
  var waitRandom = function (min, max) {
    var delay = Math.floor(Number(min || 0) + Math.random() * (Number(max || min || 0) - Number(min || 0) + 1));
    if (typeof sleep === "function") sleep(delay);
    return delay;
  };
  return {
    openDouyin: function () { return douyin.openApp ? douyin.openApp() : false; },
    openSearch: function (keyword, control) {
      if (fastSearch && fastSearch.openSearch) return fastSearch.openSearch(keyword, control);
      return douyin.openSearch ? douyin.openSearch(keyword) : false;
    },
    openLiveTab: function () {
      if (douyin.openLiveTab) return douyin.openLiveTab();
      var size = screenSize();
      var selectors = [];
      try { if (typeof text === "function") selectors.push(text("直播")); } catch (textError) {}
      try { if (typeof desc === "function") selectors.push(desc("直播")); } catch (descError) {}
      for (var selectorIndex = 0; selectorIndex < selectors.length; selectorIndex++) {
        var selector = selectors[selectorIndex];
        var nodes = [];
        try {
          if (selector && selector.find) {
            var found = selector.find();
            var count = typeof found.length === "number" ? found.length : found.size ? found.size() : 0;
            for (var foundIndex = 0; foundIndex < count; foundIndex++) {
              nodes.push(typeof found.get === "function" ? found.get(foundIndex) : found[foundIndex]);
            }
          } else if (selector && selector.findOne) {
            var one = selector.findOne(3000);
            if (one) nodes.push(one);
          }
        } catch (findError) {}
        for (var nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
          var node = nodes[nodeIndex];
          var bounds = null;
          try { bounds = node && node.bounds && node.bounds(); } catch (boundsError) { bounds = null; }
          if (!bounds || typeof bounds.centerY !== "function" || bounds.centerY() > size.height * 0.38) continue;
          var target = clickableNode(node);
          try {
            if (target && target.click && target.click()) return true;
          } catch (clickError) {}
          try {
            if (typeof click === "function" && click(bounds.centerX(), bounds.centerY())) return true;
          } catch (fallbackError) {}
        }
      }
      return false;
    },
    openFirstLive: function () {
      if (douyin.openFirstLive) {
        var opened = douyin.openFirstLive();
        if (opened === false) return { success: false, reason: "CLICK_FAILED" };
        return opened;
      }
      if (douyin.findFirstLive) {
        var firstLive = douyin.findFirstLive();
        if (!firstLive) return { success: false, reason: "NO_RESULT" };
        var firstTarget = clickableNode(firstLive);
        try {
          if (firstTarget && firstTarget.click && firstTarget.click()) return true;
        } catch (firstClickError) {}
        try {
          var firstBounds = firstLive.bounds && firstLive.bounds();
          if (firstBounds && typeof click === "function" && click(firstBounds.centerX(), firstBounds.centerY())) return true;
        } catch (firstFallbackError) {}
        return { success: false, reason: "CLICK_FAILED" };
      }
      if (typeof click === "function") {
        var size = screenSize();
        return click(Math.floor(size.width * 0.36), Math.floor(size.height * 0.35))
          ? true
          : { success: false, reason: "CLICK_FAILED" };
      }
      return { success: false, reason: "NO_RESULT" };
    },
    isLiveRoom: function () { return !!(douyin.isLiveRoomVisible && douyin.isLiveRoomVisible()); },
    waitRandom: waitRandom,
    restartSearch: function (keyword, control) {
      var fastResult = fastSearch && fastSearch.openSearch
        ? fastSearch.openSearch(keyword, control)
        : false;
      if (fastResult && fastResult.stopped) return fastResult;
      if (fastResult !== false && !(fastResult && fastResult.success === false)) return fastResult;
      return douyin.openSearch ? douyin.openSearch(keyword) : fastResult;
    }
  };
}

function clickableNode(node) {
  var target = node;
  for (var index = 0; index < 5 && target; index++) {
    try { if (target.clickable && target.clickable()) return target; } catch (error) {}
    try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
  }
  return node;
}

module.exports = {
  createLiveCommentEntryTask: createLiveCommentEntryTask
};
