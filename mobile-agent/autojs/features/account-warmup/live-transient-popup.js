function createLiveTransientPopupHandler(options) {
  options = options || {};
  var logger = options.logger || { info: function () {}, warn: function () {} };
  var findCalendarReminder = options.findCalendarReminder || function () {
    return findImmediate([
      function () { return textMatches(/^开启日历提醒$/); },
      function () { return descMatches(/.*开启日历提醒.*/); }
    ]);
  };
  var findLaterButton = options.findLaterButton || function () {
    return findImmediate([
      function () { return textMatches(/^以后再说$/); },
      function () { return descMatches(/^以后再说$/); }
    ]);
  };
  var clickNode = options.clickNode || clickNodeOrParent;

  function dismiss() {
    var reminder = findCalendarReminder();
    if (!reminder) return false;
    var later = findLaterButton();
    if (!later) {
      logger.warn("检测到开启日历提醒弹窗，但未找到以后再说按钮", {});
      return false;
    }
    if (!clickNode(later)) {
      logger.warn("开启日历提醒弹窗的以后再说按钮点击失败", {});
      return false;
    }
    logger.info("已点击开启日历提醒弹窗的以后再说", {});
    return true;
  }

  return { dismiss: dismiss };
}

function findImmediate(selectorFactories) {
  for (var index = 0; index < selectorFactories.length; index++) {
    try {
      var selector = selectorFactories[index]();
      var node = selector.findOnce ? selector.findOnce() : selector.findOne(80);
      if (node) return node;
    } catch (error) {}
  }
  return null;
}

function clickNodeOrParent(node) {
  var target = node;
  for (var level = 0; level < 6 && target; level++) {
    try {
      if (target.clickable && target.clickable() && target.click()) return true;
    } catch (clickError) {}
    try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
  }
  try {
    var bounds = node && node.bounds && node.bounds();
    return !!(bounds && typeof click === "function" && click(bounds.centerX(), bounds.centerY()));
  } catch (error) {
    return false;
  }
}

module.exports = {
  createLiveTransientPopupHandler: createLiveTransientPopupHandler
};
