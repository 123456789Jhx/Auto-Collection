function createDeviceRecoverySync(options) {
  options = options || {};
  var journal = options.journal;
  var deviceId = options.deviceId || function () { return ""; };
  var send = options.send;
  var now = options.now || function () { return Date.now(); };
  var isoNow = options.isoNow || function () { return new Date().toISOString(); };
  var retryIntervalMs = Math.max(5000, Number(options.retryIntervalMs || 30000));
  var lastAttemptAt = 0;
  var running = false;

  function flush(force) {
    var currentTime = now();
    if (running) {
      return { success: false, skipped: "already_running" };
    }
    if (!force && lastAttemptAt && currentTime - lastAttemptAt < retryIntervalMs) {
      return { success: false, skipped: "retry_interval" };
    }
    var resolvedDeviceId = String(deviceId() || "").trim();
    if (!resolvedDeviceId) {
      return { success: false, skipped: "device_unavailable" };
    }
    var pending = journal.listPending();
    if (!pending.length) {
      return { success: true, uploadedCount: 0 };
    }

    running = true;
    lastAttemptAt = currentTime;
    var uploadedCount = 0;
    try {
      for (var i = 0; i < pending.length; i++) {
        var event = pending[i];
        var reportedAt = isoNow();
        var result;
        try {
          result = send({
            deviceId: resolvedDeviceId,
            bootId: event.bootId,
            commandId: event.commandId,
            channel: event.channel,
            eventKey: event.eventKey,
            source: event.source || "AUTO_BOOT",
            stage: event.stage,
            occurredAt: event.occurredAt,
            reportedAt: reportedAt,
            details: event.details || {}
          });
        } catch (error) {
          result = { success: false, message: String(error) };
        }
        if (!result || !result.success) {
          return { success: false, uploadedCount: uploadedCount, failedEventKey: event.eventKey };
        }
        journal.markReported(event.eventKey, reportedAt);
        uploadedCount += 1;
      }
      return { success: true, uploadedCount: uploadedCount };
    } finally {
      running = false;
    }
  }

  function recordStage(stage, details, occurredAt, forceFlush) {
    var recorded = journal.recordStage(stage, details || {}, occurredAt);
    var flushed = flush(forceFlush === true && recorded.created === true);
    return { recorded: recorded, flushed: flushed };
  }

  return {
    flush: flush,
    recordStage: recordStage
  };
}

module.exports = {
  createDeviceRecoverySync: createDeviceRecoverySync
};
