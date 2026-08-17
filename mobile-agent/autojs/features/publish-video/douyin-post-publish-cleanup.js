function createDouyinPostPublishCleanup(options) {
  options = options || {};
  var logger = options.logger || { info: function () {}, warn: function () {} };
  var wait = options.wait || function (milliseconds) {
    if (typeof sleep === "function") sleep(milliseconds);
  };
  var openRecents = options.openRecents || function () {
    if (typeof recents !== "function") return false;
    recents();
    return true;
  };
  var findDouyinCard = options.findDouyinCard || function (timeoutMs) {
    var selectors = [];
    try { selectors.push(textMatches(".*抖音.*")); } catch (error) {}
    try { selectors.push(descMatches(".*抖音.*")); } catch (error) {}
    var startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      for (var index = 0; index < selectors.length; index += 1) {
        try {
          var node = selectors[index].findOne(200);
          if (node) return node;
        } catch (findError) {}
      }
    }
    return null;
  };
  var findAgentCard = options.findAgentCard || function (timeoutMs) {
    var selectors = [];
    try { selectors.push(descMatches(/.*燎原星火.*/)); } catch (error) {}
    try { selectors.push(textMatches(/^燎原星火$/)); } catch (error2) {}
    var startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      for (var index = 0; index < selectors.length; index += 1) {
        try {
          var node = selectors[index].findOne(200);
          if (node) return node;
        } catch (findError) {}
      }
    }
    return null;
  };
  var isPublishing = options.isPublishing || function () {
    try { if (textMatches(/.*(发布进度|正在发布|上传中).*/).findOne(200)) return true; } catch (error) {}
    try { if (descMatches(/.*(发布进度|正在发布|上传中).*/).findOne(200)) return true; } catch (error2) {}
    return false;
  };
  var dismissCard = options.dismissCard || function (card) {
    if (typeof swipe !== "function" || typeof device === "undefined") return false;
    var width = Number(device.width || 0);
    var height = Number(device.height || 0);
    if (width <= 0 || height <= 0) return false;
    var target = card;
    var bounds = null;
    for (var level = 0; level < 6 && target; level += 1) {
      try {
        var candidate = target.bounds && target.bounds();
        if (candidate && candidate.width() >= width * 0.35 && candidate.height() >= height * 0.12) {
          bounds = candidate;
          break;
        }
      } catch (boundsError) {}
      try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
    }
    if (!bounds) return false;
    swipe(Math.floor(bounds.left + bounds.width() * 0.8), bounds.centerY(), Math.floor(bounds.left + bounds.width() * 0.1), bounds.centerY(), 420);
    return true;
  };
  var openAgentCard = options.openAgentCard || function (card) {
    var target = card;
    for (var level = 0; level < 6 && target; level += 1) {
      try {
        if (target.clickable && target.clickable() && target.click()) return true;
      } catch (clickError) {}
      try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
    }
    return false;
  };
  var goHome = options.goHome || function () {
    if (typeof home !== "function") return false;
    home();
    return true;
  };
  var findAgentHomeIcon = options.findAgentHomeIcon || function (timeoutMs) {
    var selectors = [];
    try { selectors.push(textMatches(/^燎原星火$/)); } catch (error) {}
    try { selectors.push(descMatches(/.*燎原星火.*/)); } catch (error2) {}
    var startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      for (var index = 0; index < selectors.length; index += 1) {
        try {
          var node = selectors[index].findOne(200);
          if (node) return node;
        } catch (findError) {}
      }
    }
    return null;
  };
  var openAgentHomeIcon = options.openAgentHomeIcon || function (icon) {
    var target = icon;
    for (var level = 0; level < 6 && target; level += 1) {
      try {
        if (target.clickable && target.clickable() && target.click()) return true;
      } catch (clickError) {}
      try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
    }
    return false;
  };
  var cooldownMs = Math.max(0, Number(options.cooldownMs == null ? 30000 : options.cooldownMs));
  var recentsReadyWaitMs = Math.max(0, Number(options.recentsReadyWaitMs == null ? 1200 : options.recentsReadyWaitMs));
  var findCardTimeoutMs = Math.max(0, Number(options.findCardTimeoutMs == null ? 3000 : options.findCardTimeoutMs));
  var agentCardReadyWaitMs = Math.max(0, Number(options.agentCardReadyWaitMs == null ? 1000 : options.agentCardReadyWaitMs));
  var findAgentCardTimeoutMs = Math.max(0, Number(options.findAgentCardTimeoutMs == null ? 3000 : options.findAgentCardTimeoutMs));
  var homeReadyWaitMs = Math.max(0, Number(options.homeReadyWaitMs == null ? 1000 : options.homeReadyWaitMs));
  var findAgentHomeIconTimeoutMs = Math.max(0, Number(options.findAgentHomeIconTimeoutMs == null ? 3000 : options.findAgentHomeIconTimeoutMs));

  function fallbackToHome(taskId, reason) {
    var returnedHome = false;
    try { returnedHome = goHome() !== false; } catch (error) {}
    if (returnedHome) {
      wait(homeReadyWaitMs);
      var homeIcon = findAgentHomeIcon(findAgentHomeIconTimeoutMs);
      if (homeIcon && openAgentHomeIcon(homeIcon) !== false) {
        logger.info("已从系统主页打开燎原星火", { taskId: taskId, reason: reason });
        return { completed: true, fallback: "HOME_ICON", reason: reason };
      }
      logger.warn("未能从最近任务返回燎原星火，已回到系统主页但未找到应用图标", { taskId: taskId, reason: reason });
      return { completed: true, fallback: "HOME", reason: reason };
    }
    logger.warn("未能从最近任务返回燎原星火，且系统主页回退失败", { taskId: taskId, reason: reason });
    return { completed: false, reason: "HOME_FALLBACK_FAILED", cause: reason };
  }

  function run(payload, lifecycle) {
    var taskId = String(payload && payload.taskId || "");
    logger.info("抖音发布成功后收尾开始", { taskId: taskId, cooldownMs: cooldownMs });
    wait(cooldownMs);
    if (isPublishing()) {
      logger.warn("抖音仍显示发布进度，跳过后台清理", { taskId: taskId });
      return { completed: false, reason: "PUBLISH_STILL_IN_PROGRESS" };
    }
    if (openRecents() === false) {
      logger.warn("抖音发布成功后无法打开最近任务", { taskId: taskId });
      return { completed: false, reason: "RECENTS_UNAVAILABLE" };
    }
    wait(recentsReadyWaitMs);
    var douyinCard = findDouyinCard(findCardTimeoutMs);
    if (!douyinCard) {
      logger.warn("抖音发布成功后未识别到抖音任务卡片，跳过后台清理", { taskId: taskId });
      return { completed: false, reason: "DOUYIN_RECENTS_CARD_NOT_FOUND" };
    }
    if (dismissCard(douyinCard) === false) {
      logger.warn("抖音发布成功后未能滑出任务卡片", { taskId: taskId });
      return { completed: false, reason: "DOUYIN_RECENTS_DISMISS_FAILED" };
    }
    logger.info("抖音发布成功后后台清理完成", { taskId: taskId });
    if (lifecycle && lifecycle.beforeReturnToAgent) lifecycle.beforeReturnToAgent();
    wait(agentCardReadyWaitMs);
    var agentCard = findAgentCard(findAgentCardTimeoutMs);
    if (!agentCard) return fallbackToHome(taskId, "AGENT_RECENTS_CARD_NOT_FOUND");
    if (openAgentCard(agentCard) === false) return fallbackToHome(taskId, "AGENT_RECENTS_OPEN_FAILED");
    logger.info("已从最近任务返回燎原星火", { taskId: taskId });
    return { completed: true };
  }

  return { run: run };
}

module.exports = {
  createDouyinPostPublishCleanup: createDouyinPostPublishCleanup
};
