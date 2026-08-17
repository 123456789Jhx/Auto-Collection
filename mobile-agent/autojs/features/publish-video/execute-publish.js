// 执行发布动作与结果判定.js；职责：点击发布、等待发布完成并回传结果。
function createPublishError(message, status) {
  var error = new Error(message);
  error.publishStatus = status;
  return error;
}

function resolvePublishSuccessTimeout(payload) {
  var value = Number(payload && payload.publishSuccessTimeoutMs || 180000);
  return isFinite(value) && value >= 60000 ? value : 180000;
}

function createExecutePublishStep(ui) {
  return function executePublish(payload) {
    try {
      if (!ui.confirmReview(payload)) throw createPublishError("发布前确认复核未通过", "FAILED");
      ui.publish();
      if (!ui.waitForPublishSuccess(resolvePublishSuccessTimeout(payload))) {
        throw createPublishError("发布结果判定超时，等待人工核验", "VERIFY_PENDING");
      }
      return ui.readPublishedResult() || {};
    } catch (error) {
      if (error && error.publishStatus) throw error;
      throw createPublishError("执行发布与结果判定失败：" + String(error), "FAILED");
    }
  };
}

module.exports = {
  createExecutePublishStep: createExecutePublishStep
};