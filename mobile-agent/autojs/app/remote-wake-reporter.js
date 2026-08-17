function createRemoteWakeReporter(options) {
  options = options || {};
  var baseUrl = String(options.baseUrl || "").replace(/\/$/, "");
  var timeoutMs = Math.max(1000, Number(options.timeoutMs || 5000));
  var postJson = options.postJson || function (url, body, headers) {
    if (typeof http === "undefined" || !http.postJson) throw new Error("REMOTE_WAKE_HTTP_UNAVAILABLE");
    return http.postJson(url, body, { timeout: timeoutMs, headers: headers });
  };

  function send(command, suffix, body) {
    if (!baseUrl) throw new Error("REMOTE_WAKE_BASE_URL_MISSING");
    if (!command || !command.commandId || !command.ackToken) throw new Error("REMOTE_WAKE_REPORT_IDENTITY_MISSING");
    var url = baseUrl + "/mobile/remote-wake/commands/" + encodeURIComponent(command.commandId) + suffix;
    var response = postJson(url, body, { Authorization: "Bearer " + command.ackToken });
    var statusCode = Number(response && (response.statusCode || response.status) || 0);
    return {
      success: statusCode >= 200 && statusCode < 300,
      statusCode: statusCode
    };
  }

  function reportStage(command, stage) {
    return send(command, "/stages", { stage: stage });
  }

  function acknowledge(command, result) {
    return send(command, "/ack", result || {});
  }

  return { reportStage: reportStage, acknowledge: acknowledge };
}

module.exports = { createRemoteWakeReporter: createRemoteWakeReporter };
