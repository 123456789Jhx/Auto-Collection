function createFloatyControl(config, logger) {
  var dumpCurrentXml = require(files.join(config.runtime.scriptDir, "utils/xml-dumper.js")).dumpCurrentXml;

  var state = {
    running: false,
    paused: true,
    skipRequested: false,
    manualCaptureRequested: false,
    stopRequested: false,
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
      window.status.setVisibility(state.compact ? 8 : 0);
      window.row1.setVisibility(state.compact ? 8 : 0);
      window.row2.setVisibility(state.compact ? 8 : 0);
      window.mini.setVisibility(state.compact ? 0 : 8);
      window.mini.setText(state.paused ? "停" : "采");
      window.status.setText(
        "任务: " + config.task.taskId +
          "\n浏览: " + state.viewedCount +
          " 采集: " + state.capturedCount +
          "\n状态: " + state.lastMessage +
          "\n输出: " + config.output.baseDir
      );
    });
  }

  function create() {
    window = floaty.window(
      <vertical bg="#DD222222" padding="8">
        <text id="mini" textColor="#ffffff" textSize="12sp" text="采" w="32" h="32" gravity="center" bg="#AA2E7D32" visibility="gone" />
        <text id="status" textColor="#ffffff" textSize="12sp" text="待启动" />
        <horizontal id="row1">
          <button id="start" text="开始" w="52" h="40" />
          <button id="pause" text="暂停" w="52" h="40" />
          <button id="skip" text="跳过" w="52" h="40" />
        </horizontal>
        <horizontal id="row2">
          <button id="capture" text="采集" w="52" h="40" />
          <button id="dump" text="XML" w="52" h="40" />
          <button id="stop" text="停止" w="52" h="40" />
        </horizontal>
      </vertical>
    );

    window.setPosition(20, 180);

    window.mini.click(function () {
      state.compact = false;
      state.lastMessage = "控制台展开";
      renderStatus();
    });

    window.start.click(function () {
      state.running = true;
      state.paused = false;
      state.lastMessage = "运行中";
      logger.info("悬浮窗开始任务");
      renderStatus();
    });

    window.pause.click(function () {
      state.paused = !state.paused;
      state.lastMessage = state.paused ? "已暂停" : "运行中";
      logger.info("悬浮窗切换暂停状态", { paused: state.paused });
      renderStatus();
    });

    window.skip.click(function () {
      state.skipRequested = true;
      state.lastMessage = "请求跳过";
      logger.info("悬浮窗请求跳过");
      renderStatus();
    });

    window.capture.click(function () {
      state.manualCaptureRequested = true;
      state.lastMessage = "请求手动采集";
      logger.info("悬浮窗请求手动采集");
      renderStatus();
    });

    window.dump.click(function () {
      try {
        var filePath = dumpCurrentXml(config.output.xmlDir, logger);
        state.lastMessage = "XML已导出";
        toast("XML已保存: " + filePath);
      } catch (error) {
        state.lastMessage = "XML导出失败";
        logger.warn("页面 XML 导出失败", { message: String(error) });
      }
      renderStatus();
    });

    window.stop.click(function () {
      state.stopRequested = true;
      state.running = false;
      state.lastMessage = "停止中";
      logger.info("悬浮窗请求停止");
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

  return {
    create: create,
    update: update,
    compact: compact,
    expand: expand,
    consumeSkip: consumeSkip,
    consumeManualCapture: consumeManualCapture,
    state: state
  };
}

module.exports = {
  createFloatyControl: createFloatyControl
};
