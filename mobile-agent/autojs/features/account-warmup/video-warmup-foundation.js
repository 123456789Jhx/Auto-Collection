// 职责：承载视频养号的逐步动作；当前版本进入固定关键词搜索结果页。
function createVideoWarmupFoundationTask(options) {
  options = options || {};
  var context = options.context || {};
  var douyin = context.douyin || {};
  var logger = options.logger || { info: function () {} };
  var ui = options.ui || createDefaultUi();
  var wait = options.wait || context.sleep || function (delayMs) {
    if (typeof sleep === "function") sleep(delayMs);
  };

  function stopped(control) {
    return !!(control && control.shouldStop && control.shouldStop());
  }

  function waitOrStop(delayMs, control) {
    var remaining = Math.max(0, Number(delayMs) || 0);
    while (remaining > 0) {
      if (stopped(control)) return true;
      var step = Math.min(500, remaining);
      wait(step);
      remaining -= step;
    }
    return stopped(control);
  }

  function stoppedResult(watchedVideos) {
    return { status: "STOPPED", watchedVideos: watchedVideos || 0 };
  }

  function run(payload, control) {
    payload = payload || {};
    var keyword = String(payload.targetKeyword || "").trim();
    var secondsPerVideo = 15;
    if (!keyword) {
      if (logger.warn) logger.warn("视频养号搜索关键词为空", {});
      return { status: "VIDEO_WARMUP_KEYWORD_REQUIRED" };
    }
    logger.info("视频养号开始打开抖音", {
      targetKeyword: keyword,
      secondsPerVideo: secondsPerVideo
    });
    if (waitOrStop(5000, control)) return stoppedResult(0);
    if (!douyin.openApp || douyin.openApp() === false) {
      if (logger.warn) logger.warn("视频养号打开抖音失败", {});
      return { status: "DOUYIN_OPEN_FAILED" };
    }
    if (waitOrStop(5000, control)) return stoppedResult(0);
    if (!ui.openSearchEntry()) {
      if (logger.warn) logger.warn("视频养号点击搜索入口失败", {});
      return { status: "VIDEO_WARMUP_SEARCH_ENTRY_FAILED" };
    }
    if (!ui.setSearchKeyword(keyword)) {
      if (logger.warn) logger.warn("视频养号输入关键词失败", { keyword: keyword });
      return { status: "VIDEO_WARMUP_SEARCH_INPUT_FAILED" };
    }
    if (waitOrStop(5000, control)) return stoppedResult(0);
    if (!ui.submitSearch()) {
      if (logger.warn) logger.warn("视频养号点击搜索按钮失败", { keyword: keyword });
      return { status: "VIDEO_WARMUP_SEARCH_SUBMIT_FAILED" };
    }
    if (waitOrStop(5000, control)) return stoppedResult(0);
    if (!ui.openUpperVideoTab()) {
      if (logger.warn) logger.warn("视频养号点击第一排视频菜单失败", {});
      return { status: "VIDEO_WARMUP_UPPER_VIDEO_TAB_FAILED" };
    }
    if (waitOrStop(5000, control)) return stoppedResult(0);
    if (!ui.openLowerVideoTab()) {
      if (logger.warn) logger.warn("视频养号点击第二排视频菜单失败", {});
      return { status: "VIDEO_WARMUP_LOWER_VIDEO_TAB_FAILED" };
    }
    if (waitOrStop(5000, control)) return stoppedResult(0);
    if (!ui.openFirstVideo()) {
      if (logger.warn) logger.warn("视频养号点击第一个视频失败", {});
      return { status: "VIDEO_WARMUP_FIRST_VIDEO_FAILED" };
    }

    var watchedVideos = 0;
    while (!stopped(control)) {
      if (waitOrStop(secondsPerVideo * 1000, control)) return stoppedResult(watchedVideos);
      watchedVideos += 1;
      if (!ui.nextVideo()) {
        if (logger.warn) logger.warn("视频养号下滑失败", { watchedVideos: watchedVideos });
        return { status: "VIDEO_WARMUP_SWIPE_FAILED", watchedVideos: watchedVideos };
      }
      logger.info("视频养号已下滑到下一个视频", { watchedVideos: watchedVideos });
    }
    return stoppedResult(watchedVideos);
  }

  return { run: run };
}

function createDefaultUi() {
  function screenSize() {
    return {
      width: Math.max(1, Number(typeof device !== "undefined" && device.width || 1080)),
      height: Math.max(1, Number(typeof device !== "undefined" && device.height || 2400))
    };
  }

  function findFirst(selectors, predicate) {
    for (var i = 0; i < selectors.length; i++) {
      try {
        var node = selectors[i] && selectors[i].findOne && selectors[i].findOne(500);
        if (node && (!predicate || predicate(node))) return node;
      } catch (error) {}
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
    for (var selectorIndex = 0; selectorIndex < selectors.length; selectorIndex++) {
      try {
        var nodes = selectors[selectorIndex].find();
        var count = typeof nodes.length === "number" ? nodes.length : nodes.size ? nodes.size() : 0;
        for (var nodeIndex = 0; nodeIndex < count; nodeIndex++) {
          var node = typeof nodes.get === "function" ? nodes.get(nodeIndex) : nodes[nodeIndex];
          var bounds = node && node.bounds && node.bounds();
          if (!bounds) continue;
          var centerYRatio = bounds.centerY() / size.height;
          if (centerYRatio >= minYRatio && centerYRatio <= maxYRatio) return node;
        }
      } catch (findError) {}
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

  function nextVideo() {
    var size = screenSize();
    if (typeof swipe !== "function") return false;
    return swipe(
      Math.floor(size.width * 0.50),
      Math.floor(size.height * 0.78),
      Math.floor(size.width * 0.50),
      Math.floor(size.height * 0.22),
      520
    ) !== false;
  }

  return {
    openSearchEntry: openSearchEntry,
    setSearchKeyword: setSearchKeyword,
    submitSearch: submitSearch,
    openUpperVideoTab: openUpperVideoTab,
    openLowerVideoTab: openLowerVideoTab,
    openFirstVideo: openFirstVideo,
    nextVideo: nextVideo
  };
}

module.exports = {
  createVideoWarmupFoundationTask: createVideoWarmupFoundationTask
};
