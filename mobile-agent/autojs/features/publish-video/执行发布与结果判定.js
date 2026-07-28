function createExecutePublishStep(ui) {
  return function executePublish(payload) {
    try {
      if (!ui.confirmReview(payload)) throw new Error("发布前确认复核未通过");
      ui.publish();
      if (!ui.waitForPublishSuccess(60000)) throw new Error("发布结果判定超时");
      return ui.readPublishedResult() || {};
    } catch (error) {
      throw new Error("执行发布与结果判定失败：" + String(error));
    }
  };
}

module.exports = {
  createExecutePublishStep: createExecutePublishStep
};
