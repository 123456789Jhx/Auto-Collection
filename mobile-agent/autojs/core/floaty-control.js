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
    viewedCount: 0,
    capturedCount: 0,
    lastMessage: "待启动",
    compact: false
  };

  var window = null;

  function renderStatus() {
    if (!window) {
      return;
    }
    ui.run(function () {
      window.toggle.setText(state.running && !state.paused ? "||" : "▶");
    });
  }

  function create() {
    window = floaty.window(
      <horizontal bg="#AA222222" padding="4">
        <button id="toggle" text="▶" w="46" h="42" textSize="18sp" />
        <button id="stop" text="■" w="46" h="42" textSize="18sp" />
      </horizontal>
    );

    moveToDefaultPosition();

    window.toggle.click(function () {
      if (state.running && !state.paused) {
        state.paused = true;
        state.manualOverride = true;
        state.lastManualAction = "pause";
        state.lastMessage = "已暂停";
      } else {
        state.running = true;
        state.paused = false;
        state.stopRequested = false;
        state.exitRequested = false;
        state.manualOverride = true;
        state.lastManualAction = "start";
        state.lastMessage = "运行中";
      }
      state.lastMessage = state.paused ? "已暂停" : "运行中";
      logger.info("悬浮窗切换运行状态", {
        running: state.running,
        paused: state.paused,
        manualOverride: state.manualOverride,
        lastManualAction: state.lastManualAction
      });
      renderStatus();
    });

    window.stop.click(function () {
      state.stopRequested = true;
      state.exitRequested = true;
      state.running = false;
      state.paused = false;
      state.manualOverride = true;
      state.lastManualAction = "stop";
      state.lastMessage = "停止中";
      logger.info("悬浮窗请求停止并退出脚本");
      renderStatus();
    });

    renderStatus();
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
      logger.warn("悬浮窗移动失败", { message: String(error) });
      return false;
    }
  }

  function moveToDefaultPosition() {
    return setPosition(20, 180);
  }

  function moveToSafeCorner(reason) {
    var screenWidth = autojsUtils.getScreenSize().width;
    var x = Math.max(20, screenWidth - 140);
    var y = 120;
    logger.info("悬浮窗避让关键点击区域", { reason: reason || "", x: x, y: y });
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
      logger.warn("悬浮窗关闭失败", { message: String(error) });
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
