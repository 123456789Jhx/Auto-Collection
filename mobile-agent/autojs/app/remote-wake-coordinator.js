function createMemoryOrPersistentStore() {
  var memory = {};
  var persistent = null;
  try {
    if (typeof storages !== "undefined" && storages.create) persistent = storages.create("RemoteWakeExecutions");
  } catch (error) {}
  return {
    get: function (key) {
      if (persistent) {
        try { return persistent.get(key, null); } catch (error) {}
      }
      return memory[key] || null;
    },
    put: function (key, value) {
      memory[key] = value;
      if (persistent) {
        try { persistent.put(key, value); } catch (error) {}
      }
    }
  };
}

function createRemoteWakeCoordinator(options) {
  options = options || {};
  var screen = options.screen;
  var launcher = options.launcher;
  var reporter = options.reporter;
  var store = options.store || createMemoryOrPersistentStore();
  var totalTimeoutMs = Math.max(1000, Number(options.totalTimeoutMs || 30000));
  var screenTimeoutMs = Math.max(500, Number(options.screenTimeoutMs || 4000));
  var keyguardTimeoutMs = Math.max(500, Number(options.keyguardTimeoutMs || 4000));
  var launchTimeoutMs = Math.max(500, Number(options.launchTimeoutMs || 6000));
  var uiTimeoutMs = Math.max(500, Number(options.uiTimeoutMs || 8000));
  var now = options.now || function () { return new Date(); };
  var logger = options.logger || { info: function () {}, warn: function () {}, error: function () {} };

  function resultMessage(actionResult, fallback) {
    return actionResult && (actionResult.message || actionResult.reason) ? String(actionResult.message || actionResult.reason) : fallback;
  }

  function execute(command) {
    var existing = store.get(command.commandId);
    if (existing && (existing.status === "SUCCEEDED" || existing.status === "FAILED" || existing.status === "TIMED_OUT")) {
      reporter.acknowledge(command, existing);
      return { status: existing.status, errorCode: existing.errorCode, errorMessage: existing.errorMessage, duplicate: true };
    }
    if (existing && existing.status === "RUNNING") return { status: "RUNNING", duplicate: true };

    var startedAtMs = now().getTime();
    var commandExpiryMs = Date.parse(command.expiresAt);
    var deadlineMs = Math.min(startedAtMs + totalTimeoutMs, isFinite(commandExpiryMs) ? commandExpiryMs : startedAtMs + totalTimeoutMs);
    var terminal = null;

    function saveAndAck(result) {
      terminal = result;
      store.put(command.commandId, result);
      try { reporter.acknowledge(command, result); } catch (error) {
        logger.warn("remote wake final ACK failed", { commandId: command.commandId, message: String(error) });
      }
      return result;
    }

    function fail(errorCode, errorMessage) {
      return saveAndAck({ status: "FAILED", errorCode: errorCode, errorMessage: String(errorMessage || errorCode) });
    }

    function timeout() {
      return saveAndAck({ status: "TIMED_OUT", errorCode: "COMMAND_TIMED_OUT", errorMessage: "remote wake command timed out" });
    }

    function expired() {
      return now().getTime() >= deadlineMs;
    }

    function report(stage) {
      try {
        var response = reporter.reportStage(command, stage);
        return !response || response.success !== false;
      } catch (error) {
        logger.warn("remote wake stage report failed", { commandId: command.commandId, stage: stage, message: String(error) });
        return false;
      }
    }

    function runStep(stage, errorCode, action) {
      if (expired()) return timeout();
      var actionResult;
      try { actionResult = action(); } catch (error) {
        return fail(errorCode, String(error));
      }
      if (!actionResult || actionResult.success !== true) return fail(errorCode, resultMessage(actionResult, errorCode));
      if (expired()) return timeout();
      if (!report(stage)) return fail("ACK_REJECTED", "stage report rejected: " + stage);
      return null;
    }

    if (!command || command.targetPackage !== "com.agri.video.collector") {
      return fail("APP_LAUNCH_FAILED", "remote wake target package rejected");
    }
    if (!isFinite(commandExpiryMs) || commandExpiryMs <= startedAtMs) {
      return saveAndAck({ status: "FAILED", errorCode: "COMMAND_EXPIRED", errorMessage: "remote wake command expired" });
    }
    store.put(command.commandId, { status: "RUNNING" });
    if (!report("DEVICE_RECEIVED")) return fail("ACK_REJECTED", "stage report rejected: DEVICE_RECEIVED");

    runStep("SCREEN_ON", "SCREEN_WAKE_FAILED", function () { return screen.wake(screenTimeoutMs); });
    if (terminal) return terminal;
    runStep("KEYGUARD_DISMISSED", "KEYGUARD_DISMISS_FAILED", function () { return screen.dismissKeyguard(keyguardTimeoutMs); });
    if (terminal) return terminal;
    runStep("APP_LAUNCHED", "APP_LAUNCH_FAILED", function () { return launcher.launch(launchTimeoutMs); });
    if (terminal) return terminal;
    runStep("UI_READY", "UI_READY_TIMEOUT", function () { return launcher.waitForUiReady(uiTimeoutMs); });
    if (terminal) return terminal;

    logger.info("remote wake completed", { commandId: command.commandId, packageName: command.targetPackage });
    return saveAndAck({ status: "SUCCEEDED" });
  }

  return { execute: execute };
}

module.exports = { createRemoteWakeCoordinator: createRemoteWakeCoordinator };
