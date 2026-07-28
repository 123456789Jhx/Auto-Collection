// 原中文名：发布执行器看门狗.js；职责：监测发布执行器进度与超时。
var DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function defaultStartThread(runner) {
  if (typeof threads === "undefined" || !threads.start) return null;
  return threads.start(runner);
}

function defaultSleep(value) {
  if (typeof sleep === "function") sleep(value);
}

function createPublishExecutorWatchdog(dependencies) {
  dependencies = dependencies || {};
  var timeoutMs = Math.max(1000, Number(dependencies.timeoutMs || DEFAULT_TIMEOUT_MS));
  var startThread = dependencies.startThread || defaultStartThread;
  var sleepFor = dependencies.sleep || defaultSleep;

  function start(onTimeout) {
    var completed = false;
    var timeoutTriggered = false;
    var thread = startThread(function () {
      try {
        sleepFor(timeoutMs);
        if (completed || timeoutTriggered) return;
        timeoutTriggered = true;
        onTimeout();
      } catch (error) {
        if (!completed && !timeoutTriggered) throw error;
      }
    });
    return {
      complete: function () {
        completed = true;
        try {
          if (thread && thread.interrupt) thread.interrupt();
        } catch (error) {}
      },
      timedOut: function () { return timeoutTriggered; }
    };
  }

  return { start: start, timeoutMs: timeoutMs };
}

module.exports = {
  createPublishExecutorWatchdog: createPublishExecutorWatchdog
};
