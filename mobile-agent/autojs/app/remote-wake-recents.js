function createRemoteWakeRecents(options) {
  options = options || {};
  var targetLabel = "燎原星火";
  var wait = options.wait || function (milliseconds) {
    if (typeof sleep === "function") sleep(milliseconds);
  };
  var openRecents = options.openRecents || function () {
    if (typeof recents !== "function") return false;
    recents();
    return true;
  };
  var performSwipe = options.swipe || function (x1, y1, x2, y2, durationMs) {
    if (typeof swipe !== "function") return false;
    swipe(x1, y1, x2, y2, durationMs);
    return true;
  };
  var findLiaoyuanCard = options.findLiaoyuanCard || function (timeoutMs) {
    var selectors = [];
    try { selectors.push(descMatches(/.*燎原星火.*/)); } catch (error) {}
    try { selectors.push(textMatches(/^燎原星火$/)); } catch (error2) {}
    var attempts = Math.max(1, Math.ceil(Number(timeoutMs || 0) / 200));
    for (var attempt = 0; attempt < attempts; attempt += 1) {
      for (var index = 0; index < selectors.length; index += 1) {
        try {
          var node = selectors[index].findOne(200);
          if (node) return node;
        } catch (findError) {}
      }
    }
    return null;
  };

  function dimensions() {
    return {
      width: Number(options.width || (typeof device !== "undefined" && device.width) || 1080),
      height: Number(options.height || (typeof device !== "undefined" && device.height) || 1920)
    };
  }

  function cardBounds(node) {
    var size = dimensions();
    var current = node;
    for (var level = 0; level < 7 && current; level += 1) {
      try {
        var bounds = current.bounds && current.bounds();
        if (bounds && bounds.width() >= size.width * 0.35 && bounds.height() >= size.height * 0.12) return bounds;
      } catch (error) {}
      try { current = current.parent && current.parent(); } catch (parentError) { current = null; }
    }
    return null;
  }

  function clearExistingTask() {
    try {
      if (openRecents() === false) return { success: false, reason: "RECENTS_UNAVAILABLE" };
      wait(Number(options.recentsReadyWaitMs || 900));
      var card = findLiaoyuanCard(Number(options.findTimeoutMs || 2500));
      if (!card) return { success: true, cleared: false, reason: "TASK_NOT_PRESENT" };
      var bounds = cardBounds(card);
      if (!bounds) return { success: false, reason: "TASK_CARD_BOUNDS_UNAVAILABLE" };
      var startX = Math.floor(bounds.left + bounds.width() * 0.82);
      var endX = Math.floor(bounds.left + bounds.width() * 0.08);
      if (performSwipe(startX, bounds.centerY(), endX, bounds.centerY(), 420) === false) {
        return { success: false, reason: "TASK_CARD_SWIPE_FAILED" };
      }
      wait(Number(options.dismissWaitMs || 700));
      if (findLiaoyuanCard(Number(options.verifyTimeoutMs || 500))) {
        return { success: false, reason: "TASK_CARD_STILL_PRESENT" };
      }
      return { success: true, cleared: true };
    } catch (error) {
      return { success: false, reason: "TASK_CLEAR_EXCEPTION", message: String(error) };
    }
  }

  return { targetLabel: targetLabel, clearExistingTask: clearExistingTask };
}

module.exports = { createRemoteWakeRecents: createRemoteWakeRecents };
