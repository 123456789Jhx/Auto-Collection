var commandModule = require("./remote-wake-command.js");
function createRemoteWakeCommandBridge(context, options) {
  options = options || {};
  var uploader = context.uploader;
  var logger = context.logger || { info: function () {}, warn: function () {}, error: function () {} };
  var installed = false;
  var originalPoll = null;

  function intercept(commands) {
    var passthrough = [];
    if (commands && commands.deviceRecoveryRequestSucceeded) {
      passthrough.deviceRecoveryRequestSucceeded = true;
    }
    commands = commands || [];
    for (var index = 0; index < commands.length; index += 1) {
      var raw = commands[index];
      if (!raw || raw.commandType !== commandModule.REMOTE_WAKE_COMMAND_TYPE) {
        passthrough.push(raw);
        continue;
      }
      logger.info("remote wake command delegated to native base", {
        commandId: raw.id || raw.commandId || "",
        deviceId: context.config.device.deviceId
      });
    }
    return passthrough;
  }

  function install() {
    if (installed) return false;
    if (!uploader || typeof uploader.pollCommands !== "function") throw new Error("REMOTE_WAKE_POLL_UNAVAILABLE");
    originalPoll = uploader.pollCommands;
    uploader.pollCommands = function () {
      return intercept(originalPoll.apply(uploader, arguments));
    };
    installed = true;
    return true;
  }

  function uninstall() {
    if (!installed) return false;
    uploader.pollCommands = originalPoll;
    installed = false;
    return true;
  }

  return { intercept: intercept, install: install, uninstall: uninstall };
}

module.exports = { createRemoteWakeCommandBridge: createRemoteWakeCommandBridge };
