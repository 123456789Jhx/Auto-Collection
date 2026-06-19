function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function containsAny(text, values) {
  text = normalize(text);
  values = values || [];
  for (var i = 0; i < values.length; i++) {
    var value = normalize(values[i]);
    if (value && text.indexOf(value) >= 0) {
      return true;
    }
  }
  return false;
}

function matchedValues(text, values) {
  text = normalize(text);
  values = values || [];
  var result = [];
  for (var i = 0; i < values.length; i++) {
    var value = normalize(values[i]);
    if (value && text.indexOf(value) >= 0) {
      result.push(value);
    }
  }
  return result;
}

function hashText(text) {
  text = normalize(text);
  var hash = 0;
  for (var i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function createTriggerDetector(options) {
  options = options || {};
  var leaderAccountNames = options.leaderAccountNames || [];
  var leaderAccountIds = options.leaderAccountIds || [];
  var triggerKeywords = options.triggerKeywords || [];

  function updateOptions(nextOptions) {
    nextOptions = nextOptions || {};
    leaderAccountNames = nextOptions.leaderAccountNames || [];
    leaderAccountIds = nextOptions.leaderAccountIds || [];
    triggerKeywords = nextOptions.triggerKeywords || [];
  }

  function detect(comment, meta) {
    var text = normalize(comment && (comment.text || comment.raw || comment));
    if (!text) {
      return null;
    }

    var author = normalize(comment && (comment.authorName || comment.author || ""));
    var content = normalize(comment && comment.content) || text;
    var leaderMatched =
      containsAny(author, leaderAccountNames) ||
      containsAny(author, leaderAccountIds);
    var lowConfidenceLeaderMentioned =
      !leaderMatched &&
      !author &&
      (containsAny(text, leaderAccountNames) || containsAny(text, leaderAccountIds));
    var keywordMatched = triggerKeywords.length ? containsAny(content, triggerKeywords) : true;

    if ((!leaderMatched && !lowConfidenceLeaderMentioned) || !keywordMatched) {
      return null;
    }

    var eventId = [
      (meta && meta.taskId) || "",
      (meta && meta.deviceId) || "",
      normalize(author || leaderAccountNames[0] || "leader"),
      hashText(content)
    ].join(":");

    return {
      eventId: eventId,
      taskId: (meta && meta.taskId) || "",
      deviceId: (meta && meta.deviceId) || "",
      roomName: (meta && meta.roomName) || "",
      leaderAccountName: author || leaderAccountNames[0] || "",
      leaderAccountId: leaderAccountIds[0] || "",
      triggerText: content,
      matchedKeywords: matchedValues(content, triggerKeywords),
      confidence: leaderMatched ? 0.9 : 0.45,
      detectedAt: new Date().toISOString(),
      status: leaderMatched ? "detected" : "log_only"
    };
  }

  return {
    detect: detect,
    updateOptions: updateOptions
  };
}

module.exports = {
  createTriggerDetector: createTriggerDetector
};
