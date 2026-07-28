function normalizeTopic(value) {
  return String(value || "")
    .replace(/^#+/, "")
    .replace(/[，,。；;！!？?]+$/g, "")
    .trim();
}

function extractTopics(value) {
  var text = String(value || "");
  var topics = [];
  var seen = {};
  var match;
  var pattern = /#([^#\s，,。；;！!？?]+)/g;
  while ((match = pattern.exec(text))) {
    var topic = normalizeTopic(match[1]);
    if (topic && !seen[topic]) {
      seen[topic] = true;
      topics.push(topic);
    }
  }
  return topics;
}

function normalizeObservedTopics(value) {
  if (Object.prototype.toString.call(value) === "[object Array]") {
    return value.map(normalizeTopic).filter(Boolean);
  }
  return extractTopics(value);
}

function validateTopics(description, observedTopics, expectedTopicCount) {
  var expected = Math.max(1, Number(expectedTopicCount || 1));
  var required = extractTopics(description);
  var observed = normalizeObservedTopics(observedTopics);
  var observedMap = {};
  for (var i = 0; i < observed.length; i++) observedMap[observed[i]] = true;
  var missing = required.filter(function (topic) { return !observedMap[topic]; });
  var valid = required.length >= expected && observed.length >= expected && missing.length === 0;
  var reason = "";
  if (required.length < expected) {
    reason = "描述中的话题数量不足，预期" + expected + "个";
  } else if (observed.length < expected) {
    reason = "界面已选话题数量不足，缺少：" + missing.join("、");
  } else if (missing.length) {
    reason = "界面未选中话题：" + missing.join("、");
  }
  return {
    valid: valid,
    status: valid ? "READY" : "TOPIC_PENDING",
    reason: reason,
    requiredTopics: required,
    observedTopics: observed,
    missingTopics: missing
  };
}

module.exports = {
  extractTopics: extractTopics,
  validateTopics: validateTopics
};
