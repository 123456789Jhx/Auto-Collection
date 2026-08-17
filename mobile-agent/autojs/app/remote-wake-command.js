var REMOTE_WAKE_COMMAND_TYPE = "OPEN_AGENT_APP";
var REMOTE_WAKE_TARGET_PACKAGE = "com.agri.video.collector";

function parseRemoteWakeCommand(command, options) {
  options = options || {};
  if (!command || command.commandType !== REMOTE_WAKE_COMMAND_TYPE) return null;
  var payload = command.payload || command.payloadJson || {};
  var commandId = String(payload.commandId || command.commandId || command.id || "").trim();
  var deviceId = String(payload.deviceId || command.deviceId || "").trim();
  var expectedDeviceId = String(options.deviceId || "").trim();
  var ackToken = String(payload.ackToken || command.ackToken || "").trim();
  var expiresAt = String(payload.expiresAt || command.expiresAt || "").trim();
  var expiresAtMs = Date.parse(expiresAt);
  var now = options.now ? options.now() : new Date();

  if (!commandId) throw new Error("REMOTE_WAKE_COMMAND_ID_MISSING");
  if (!deviceId) throw new Error("REMOTE_WAKE_DEVICE_ID_MISSING");
  if (expectedDeviceId && deviceId !== expectedDeviceId) throw new Error("REMOTE_WAKE_DEVICE_MISMATCH");
  if (!ackToken) throw new Error("REMOTE_WAKE_ACK_TOKEN_MISSING");
  if (!isFinite(expiresAtMs)) throw new Error("REMOTE_WAKE_EXPIRY_INVALID");
  if (expiresAtMs <= now.getTime()) throw new Error("COMMAND_EXPIRED");

  return {
    commandType: REMOTE_WAKE_COMMAND_TYPE,
    commandId: commandId,
    deviceId: deviceId,
    issuedAt: String(payload.issuedAt || command.issuedAt || ""),
    expiresAt: new Date(expiresAtMs).toISOString(),
    ackToken: ackToken,
    targetPackage: REMOTE_WAKE_TARGET_PACKAGE
  };
}

module.exports = {
  REMOTE_WAKE_COMMAND_TYPE: REMOTE_WAKE_COMMAND_TYPE,
  REMOTE_WAKE_TARGET_PACKAGE: REMOTE_WAKE_TARGET_PACKAGE,
  parseRemoteWakeCommand: parseRemoteWakeCommand
};
