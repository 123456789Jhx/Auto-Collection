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

// Keep this rule in sync with apps/api/src/services/publish-topics.ts.
function validateDescriptionTopics(description, expectedTopicCount) {
  var text = String(description || "");
  var expected = Math.max(1, Math.floor(Number(expectedTopicCount || 5)));
  var markers = [];
  for (var index = 0; index < text.length; index++) {
    if (text.charAt(index) === "#") markers.push(index);
  }
  if (markers.length !== expected) {
    return {
      valid: false,
      actualCount: markers.length,
      reason: "应有" + expected + "个#，实际" + markers.length + "个"
    };
  }
  for (var markerIndex = 0; markerIndex < markers.length; markerIndex++) {
    var next = text.charAt(markers[markerIndex] + 1);
    if (!next || /[\s#，,。；;！!？?]/.test(next)) {
      return {
        valid: false,
        actualCount: markers.length,
        reason: "第" + (markerIndex + 1) + "个#后无文字"
      };
    }
  }
  return { valid: true, actualCount: markers.length, reason: "" };
}

function validateTopics(description, observedTopics, expectedTopicCount) {
  var descriptionValidation = validateDescriptionTopics(description, expectedTopicCount);
  var required = extractTopics(description);
  var observed = normalizeObservedTopics(observedTopics);
  var observedMap = {};
  for (var i = 0; i < observed.length; i++) observedMap[observed[i]] = true;
  var missing = required.filter(function (topic) { return !observedMap[topic]; });
  var valid = descriptionValidation.valid && missing.length === 0;
  var reason = descriptionValidation.reason;
  if (descriptionValidation.valid && missing.length) {
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
  validateDescriptionTopics: validateDescriptionTopics,
  validateTopics: validateTopics
};
