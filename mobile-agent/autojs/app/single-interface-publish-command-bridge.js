// Runs only the single-interface publish command on an interruptible worker thread.
function createSingleInterfacePublishCommandBridge(context, dependencies) {
  dependencies = dependencies || {};
  var uploader = context.uploader;
  var logger = context.logger || { info: function () {}, warn: function () {}, error: function () {} };
  var execute = dependencies.execute;
  var active = null;
  var installed = false;
  var originalPoll = null;

  function startThread(runner) {
    if (context.startThread) return context.startThread(runner);
    if (typeof threads !== "undefined" && threads.start) return threads.start(runner);
    return runner();
  }

  function payloadOf(command) {
    return command && (command.payload || command.payloadJson || {}) || {};
  }

  function ack(command, status, result) {
    return uploader.ackCommand(command.id, status, result || {});
  }

  function runCommand(command) {
    var payload = payloadOf(command);
    if (!String(command.id || "") || !String(payload.runId || "") || !String(payload.taskId || "")) {
      ack(command, "FAILED", { status: "INVALID_SINGLE_INTERFACE_PUBLISH_IDENTITY" });
      return;
    }
    if (active) {
      if (active.commandId !== command.id) {
        ack(command, "FAILED", { status: "SINGLE_INTERFACE_PUBLISH_BUSY" });
      }
      return;
    }
    var runState = {
      commandId: String(command.id || ""),
      runId: String(payload.runId || ""),
      taskId: String(payload.taskId || ""),
      thread: null
    };
    active = runState;
    runState.thread = startThread(function () {
      try {
        execute({
          id: command.id,
          commandType: "PUBLISH_VIDEO_TASK",
          payload: payload
        });
      } catch (error) {
        logger.warn("single interface publish worker ended", {
          commandId: runState.commandId,
          message: String(error)
        });
      } finally {
        if (active === runState) active = null;
      }
    });
  }

  function stopMatches(payload) {
    return !!(active &&
      String(payload.runId || "") === active.runId &&
      String(payload.taskId || "") === active.taskId &&
      String(payload.targetCommandId || "") === active.commandId);
  }

  function stopCommand(command) {
    var payload = payloadOf(command);
    if (!stopMatches(payload)) {
      ack(command, "IGNORED", {
        status: "NO_MATCHING_SINGLE_INTERFACE_PUBLISH",
        runId: String(payload.runId || ""),
        taskId: String(payload.taskId || ""),
        targetCommandId: String(payload.targetCommandId || "")
      });
      return;
    }
    var runState = active;
    try {
      if (runState.thread && typeof runState.thread.interrupt === "function") {
        runState.thread.interrupt();
      }
    } catch (error) {
      logger.warn("single interface publish interrupt failed", {
        commandId: runState.commandId,
        message: String(error)
      });
    }
    active = null;
    ack(command, "DONE", {
      status: "STOPPED",
      runId: runState.runId,
      taskId: runState.taskId,
      targetCommandId: runState.commandId,
      externalMaterialReleased: false
    });
  }

  function intercept(commands) {
    var passthrough = [];
    commands = commands || [];
    for (var index = 0; index < commands.length; index += 1) {
      var command = commands[index];
      if (command.commandType === "SINGLE_INTERFACE_PUBLISH_TASK") {
        runCommand(command);
      } else if (command.commandType === "SINGLE_INTERFACE_PUBLISH_STOP") {
        stopCommand(command);
      } else {
        passthrough.push(command);
      }
    }
    return passthrough;
  }

  function install() {
    if (installed) return false;
    if (typeof execute !== "function") throw new Error("single interface publish executor is required");
    originalPoll = uploader.pollCommands;
    uploader.pollCommands = function () {
      return intercept(originalPoll.apply(uploader, arguments));
    };
    installed = true;
    return true;
  }

  return {
    install: install,
    intercept: intercept,
    getActive: function () { return active; }
  };
}

module.exports = {
  createSingleInterfacePublishCommandBridge: createSingleInterfacePublishCommandBridge
};
