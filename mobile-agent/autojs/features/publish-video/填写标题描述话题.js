function topicPending(message) {
  var error = new Error(message);
  error.publishStatus = "TOPIC_PENDING";
  return error;
}

function createFillPublishTextStep(ui, topicDomain) {
  return function fillPublishText(payload) {
    try {
      ui.fillTitleAndDescription(payload.title, payload.description);
      var requiredTopics = topicDomain.extractTopics(payload.description);
      for (var i = 0; i < requiredTopics.length; i++) ui.selectTopic(requiredTopics[i]);
      var validation = topicDomain.validateTopics(
        payload.description,
        ui.listSelectedTopics(),
        payload.expectedTopicCount
      );
      if (!validation.valid) throw topicPending(validation.reason || "话题待补充");
      return validation;
    } catch (error) {
      if (error && error.publishStatus) throw error;
      throw topicPending("填写标题描述话题失败：" + String(error));
    }
  };
}

module.exports = {
  createFillPublishTextStep: createFillPublishTextStep
};
