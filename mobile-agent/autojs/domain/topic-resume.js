// 原中文名：话题断点续传.js；职责：持久化话题填写断点。
function defaultSleep(value) {
  if (typeof sleep === "function") sleep(value);
}

function defaultKeepAwake(value) {
  if (typeof device !== "undefined" && device.keepScreenOn) device.keepScreenOn(value);
}

function defaultReleaseAwake() {
  if (typeof device !== "undefined" && device.cancelKeepingAwake) device.cancelKeepingAwake();
}

function createTopicContinuation(dependencies) {
  dependencies = dependencies || {};
  var fetchTopic = dependencies.fetchTopic;
  var sleepFor = dependencies.sleep || defaultSleep;
  var now = dependencies.now || function () { return Date.now(); };
  var keepAwake = dependencies.keepAwake || defaultKeepAwake;
  var releaseAwake = dependencies.releaseAwake || defaultReleaseAwake;
  var validateDescription = dependencies.validateDescriptionTopics ||
    require("./topic-validator.js").validateDescriptionTopics;
  var pollIntervalMs = Number(dependencies.pollIntervalMs || 20000);

  if (typeof fetchTopic !== "function") throw new Error("话题断点续传缺少查询函数");

  function waitForResolvedDescription(payload) {
    var timeoutMinutes = Math.max(1, Number(payload.topicResolveTimeoutMinutes || 30));
    var timeoutMs = timeoutMinutes * 60 * 1000;
    var startedAt = now();
    keepAwake(timeoutMs);
    try {
      while (now() - startedAt < timeoutMs) {
        var response = fetchTopic(payload.taskId);
        if (response && response.resolved && typeof response.description === "string") {
          var validation = validateDescription(response.description, payload.expectedTopicCount);
          if (validation.valid) return response.description;
        }
        var remaining = timeoutMs - (now() - startedAt);
        if (remaining > 0) sleepFor(Math.min(pollIntervalMs, remaining));
      }
      throw new Error("话题补全超时");
    } finally {
      releaseAwake();
    }
  }

  return { waitForResolvedDescription: waitForResolvedDescription };
}

module.exports = {
  createTopicContinuation: createTopicContinuation
};
