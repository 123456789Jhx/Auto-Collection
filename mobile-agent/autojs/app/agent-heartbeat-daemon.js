function createAgentHeartbeatDaemon(context, deps) {
  deps = deps || {};
  var config = context.config || {};
  var runtime = config.runtime || {};
  var logger = context.logger || {};
  var heartbeatService = context.heartbeatService;
  var floatyControl = context.floatyControl;
  var started = false;
  var stopped = false;
  var worker = null;

  function logInfo(message, payload) {
    if (logger.info) {
      logger.info(message, payload || {});
    }
  }

  function logWarn(message, payload) {
    if (logger.warn) {
      logger.warn(message, payload || {});
    }
  }

  function intervalMs() {
    var seconds = Number(runtime.agentHeartbeatDaemonSeconds || runtime.agentHeartbeatSeconds || runtime.idleHeartbeatSeconds || 60);
    return Math.max(1000, seconds * 1000);
  }

  function defaultSleep(ms) {
    if (typeof sleep === "function") {
      sleep(ms);
    }
  }

  function sleepMs(ms) {
    (deps.sleep || defaultSleep)(ms);
  }

  function threadStart(fn) {
    if (deps.threadStart) {
      return deps.threadStart(fn);
    }
    if (typeof threads !== "undefined" && threads.start) {
      return threads.start(fn);
    }
    return null;
  }

  function state() {
    return floatyControl && floatyControl.state ? floatyControl.state : {};
  }

  function isExitRequested() {
    return !!state().exitRequested;
  }

  function activeWarmupRun() {
    var bridge = context.accountWarmupCommandBridge;
    if (!bridge || typeof bridge.getActive !== "function") {
      return null;
    }
    try {
      return bridge.getActive() || null;
    } catch (error) {
      logWarn("读取养号任务活动状态失败", { message: String(error) });
      return null;
    }
  }

  function currentStatus() {
    var current = state();
    var warmupRun = activeWarmupRun();
    if (current.stopRequested) {
      return "stopped";
    }
    if (current.paused) {
      return "paused";
    }
    if (warmupRun && warmupRun.stopRequested) {
      return "stopped";
    }
    if (current.running || warmupRun) {
      return "running";
    }
    return "idle";
  }

  function currentMessage() {
    return state().lastMessage || "Agent 心跳";
  }

  function report() {
    if (!heartbeatService || !heartbeatService.reportAgentHeartbeat) {
      return;
    }
    heartbeatService.reportAgentHeartbeat(currentStatus(), currentMessage(), true);
  }

  function loop() {
    logInfo("Agent 独立心跳守护已启动", { intervalMs: intervalMs() });
    report();
    while (!stopped && !isExitRequested()) {
      sleepMs(intervalMs());
      if (stopped || isExitRequested()) {
        break;
      }
      report();
    }
    logInfo("Agent 独立心跳守护已停止");
  }

  function start() {
    if (started) {
      return true;
    }
    if (!heartbeatService || !heartbeatService.reportAgentHeartbeat) {
      logWarn("Agent 独立心跳守护未启动：心跳服务缺失");
      return false;
    }
    stopped = false;
    try {
      worker = threadStart(loop);
      if (!worker) {
        logWarn("Agent 独立心跳守护未启动：当前环境不支持后台线程");
        return false;
      }
      started = true;
      return true;
    } catch (error) {
      logWarn("Agent 独立心跳守护启动失败", { message: String(error) });
      return false;
    }
  }

  function stop() {
    stopped = true;
    if (worker && worker.interrupt) {
      try {
        worker.interrupt();
      } catch (error) {
        logWarn("Agent 独立心跳守护中断失败", { message: String(error) });
      }
    }
  }

  return {
    start: start,
    stop: stop
  };
}

module.exports = {
  createAgentHeartbeatDaemon: createAgentHeartbeatDaemon
};
