function containsAny(text, words) {
  if (!text || !words) {
    return [];
  }

  return words.filter(function (word) {
    return word && text.indexOf(word) >= 0;
  });
}

function createMatcher(config) {
  function evaluate(text) {
    var agricultureHits = containsAny(text, config.match.agricultureKeywords);
    var marketingHits = containsAny(text, config.match.marketingKeywords);
    var lowPriorityHits = containsAny(text, config.match.lowPriorityKeywords);
    var liveHits = containsAny(text, config.match.liveKeywords);

    var priority = "none";
    if (agricultureHits.length > 0) {
      priority = "normal";
    }
    if (agricultureHits.length >= 2) {
      priority = "high";
    }
    if (marketingHits.length > 0) {
      priority = "marketing";
    }
    if (lowPriorityHits.length > 0 && agricultureHits.length === 0) {
      priority = "low";
    }

    return {
      matched: agricultureHits.length > 0,
      priority: priority,
      agricultureHits: agricultureHits,
      marketingHits: marketingHits,
      lowPriorityHits: lowPriorityHits,
      liveHits: liveHits,
      liveMatched: liveHits.length > 0
    };
  }

  return {
    evaluate: evaluate
  };
}

module.exports = {
  createMatcher: createMatcher
};
