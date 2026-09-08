function createFloatyControl(config, logger) {
  var autojsUtils = require(files.join(config.runtime.scriptDir, "utils/autojs-utils.js"));

  var state = {
    running: false,
    paused: true,
    skipRequested: false,
    manualCaptureRequested: false,
    stopRequested: false,
    exitRequested: false,
    manualOverride: false,
    lastManualAction: "",
    liveCommentExecutionEnabled: false,
    liveCommentControlStatus: "stopped",
    viewedCount: 0,
    capturedCount: 0,
    lastMessage: "\u5f85\u542f\u52a8",
    compact: false
  };

  var window = null;

  function renderStatus() {
    // 状态只保存在 state 中并通过心跳上报，手机端不显示状态文字。
  }

  function create() {
    window = null;
  }

  function update(patch) {
    Object.keys(patch || {}).forEach(function (key) {
      state[key] = patch[key];
    });
    renderStatus();
  }

  function setPosition(x, y) {
    try {
      if (!window || !window.setPosition) {
        return false;
      }
      window.setPosition(Math.floor(x), Math.floor(y));
      return true;
    } catch (error) {
      logger.warn("floaty move failed", { message: String(error) });
      return false;
    }
  }

  function moveToDefaultPosition() {
    return setPosition(20, 180);
  }

  function moveToSafeCorner(reason) {
    var screen = autojsUtils.getScreenSize();
    var reasonText = String(reason || "");
    var x = Math.max(20, screen.width - 140);
    var y = Math.floor(Math.max(260, screen.height * 0.22));
    if (/search/i.test(reasonText)) {
      x = 20;
      y = Math.floor(Math.max(420, screen.height * 0.78));
    }
    y = Math.max(80, Math.min(y, screen.height - 180));
    logger.info("floaty moved to safe corner", { reason: reason || "", x: x, y: y });
    return setPosition(x, y);
  }

  function consumeSkip() {
    var value = state.skipRequested;
    state.skipRequested = false;
    return value;
  }

  function consumeManualCapture() {
    var value = state.manualCaptureRequested;
    state.manualCaptureRequested = false;
    return value;
  }

  function compact(message) {
    state.compact = true;
    if (message) {
      state.lastMessage = message;
    }
    renderStatus();
    sleep(250);
  }

  function expand(message) {
    state.compact = false;
    if (message) {
      state.lastMessage = message;
    }
    renderStatus();
    sleep(150);
  }

  function close() {
    try {
      if (window && window.close) {
        window.close();
      }
    } catch (error) {
      logger.warn("floaty close failed", { message: String(error) });
    }
    window = null;
  }

  return {
    create: create,
    update: update,
    compact: compact,
    expand: expand,
    close: close,
    moveToDefaultPosition: moveToDefaultPosition,
    moveToSafeCorner: moveToSafeCorner,
    consumeSkip: consumeSkip,
    consumeManualCapture: consumeManualCapture,
    state: state
  };
}

module.exports = {
  createFloatyControl: createFloatyControl
};
