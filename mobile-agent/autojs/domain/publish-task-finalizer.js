// 职责：幂等完成发布结果上报、命令回执与本地执行资源释放。
function createPublishTaskFinalizer(options) {
  options = options || {};
  var logger = options.logger || { info: function () {}, warn: function () {} };
  var resultReporter = options.resultReporter;
  var uploader = options.uploader;
  var device = options.device || {};
  var states = {};

  function keyOf(input) {
    return String(input.command && input.command.id || input.payload && input.payload.taskId || "unknown");
  }

  function resultOf(input, reportFailure, ackFailure) {
    var publishResult = input.publishResult || {};
    var result = {
      status: input.status,
      error: input.errorMessage || "",
      publishedUrl: publishResult.publishedUrl || "",
      platformContentId: publishResult.platformContentId || ""
    };
    if (reportFailure) {
      result.reportFailed = true;
      result.reportError = reportFailure;
    }
    if (ackFailure) {
      result.ackFailed = true;
      result.ackError = ackFailure;
    }
    return result;
  }

  function finalize(input) {
    input = input || {};
    var key = keyOf(input);
    var state = states[key];
    if (state && state.completed) return state.result;
    if (!state) {
      state = { reported: false, acked: false, resourcesReleased: false, completed: false, result: null };
      states[key] = state;
    }

    var payload = input.payload || {};
    var reportFailure = "";
    var ackFailure = "";
    if (!state.reported) {
      var report = {
        deviceId: device.deviceId || "",
        deviceToken: device.deviceToken || "",
        status: input.status
      };
      if (input.errorMessage) report.error = input.errorMessage;
      if (input.publishResult && input.publishResult.publishedUrl) report.publishedUrl = input.publishResult.publishedUrl;
      if (input.publishResult && input.publishResult.platformContentId) report.platformContentId = input.publishResult.platformContentId;
      try {
        resultReporter.report(payload.taskId, report);
        state.reported = true;
      } catch (error) {
        reportFailure = "发布结果回传失败：" + String(error);
        logger.warn("发布结果回传失败", { taskId: payload.taskId || "", message: reportFailure });
      }
    }

    if (!state.acked) {
      var ackStatus = reportFailure ? "FAILED" : input.status === "SUCCEEDED" ? "DONE" : "FAILED";
      try {
        uploader.ackCommand(input.command && input.command.id, ackStatus, {
          applied: !reportFailure && input.status === "SUCCEEDED",
          commandType: "PUBLISH_VIDEO_TASK",
          status: input.status,
          message: reportFailure || input.errorMessage || "",
          publishedUrl: input.publishResult && input.publishResult.publishedUrl || "",
          platformContentId: input.publishResult && input.publishResult.platformContentId || ""
        });
        state.acked = true;
      } catch (error2) {
        ackFailure = "发布命令回执失败：" + String(error2);
        logger.warn("发布命令回执失败", { taskId: payload.taskId || "", message: ackFailure });
      }
    }

    if (!state.resourcesReleased) {
      try {
        if (input.releaseResources) input.releaseResources();
        state.resourcesReleased = true;
      } catch (error3) {
        logger.warn("发布执行资源释放失败", { taskId: payload.taskId || "", message: String(error3) });
      }
    }

    state.result = resultOf(input, reportFailure, ackFailure);
    state.completed = state.acked && state.resourcesReleased;
    if (state.completed) {
      logger.info("发布任务终态收口完成", {
        commandId: input.command && input.command.id || "",
        taskId: payload.taskId || "",
        status: input.status,
        reportFailed: !!reportFailure
      });
    }
    return state.result;
  }

  return { finalize: finalize };
}

module.exports = {
  createPublishTaskFinalizer: createPublishTaskFinalizer
};
