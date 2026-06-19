function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeList(value) {
  var result = [];
  value = value || [];
  for (var i = 0; i < value.length; i++) {
    var item = normalizeText(value[i]);
    if (item) {
      result.push(item);
    }
  }
  return result;
}

function collectProfileKeywords(profile) {
  var keywords = [];
  profile = profile || {};
  var products = profile.products || [];
  for (var i = 0; i < products.length; i++) {
    var product = products[i] || {};
    if (product.name) keywords.push(product.name);
    keywords = keywords.concat(normalizeList(product.topics || []));
  }
  keywords = keywords.concat(normalizeList(profile.interests || []));
  return keywords;
}

function contains(text, keyword) {
  return keyword && text.indexOf(keyword) >= 0;
}

function unique(items) {
  var seen = {};
  var result = [];
  for (var i = 0; i < items.length; i++) {
    var item = normalizeText(items[i]);
    if (item && !seen[item]) {
      seen[item] = true;
      result.push(item);
    }
  }
  return result;
}

function createLiveRoomRelevanceDetector(options) {
  options = options || {};
  var baseKeywords = normalizeList(options.baseKeywords || []);
  var negativeKeywords = normalizeList(options.negativeKeywords || [
    "游戏", "娱乐", "明星", "八卦", "搞笑", "招商", "加盟", "卖课", "私信", "加微信", "代理", "带货暴富"
  ]);

  function detect(input) {
    input = input || {};
    var config = input.botConfig || {};
    var threshold = Math.max(1, Number(config.roomRelevanceThreshold || 60));
    var text = normalizeText([
      input.text || "",
      input.commentsText || "",
      input.roomName || ""
    ].join(" "));
    var keywords = unique(baseKeywords.concat(normalizeList(config.topicTags || [])).concat(collectProfileKeywords(input.accountProfile)));
    var matched = [];
    var negative = [];
    var score = 0;

    for (var i = 0; i < keywords.length; i++) {
      if (contains(text, keywords[i])) {
        matched.push(keywords[i]);
        score += keywords[i].length >= 3 ? 18 : 12;
      }
    }
    for (var j = 0; j < negativeKeywords.length; j++) {
      if (contains(text, negativeKeywords[j])) {
        negative.push(negativeKeywords[j]);
        score -= 25;
      }
    }

    if (matched.length >= 2) {
      score += 18;
    }
    score = Math.max(0, Math.min(100, score));

    return {
      related: score >= threshold,
      score: score,
      threshold: threshold,
      matchedKeywords: unique(matched),
      negativeKeywords: unique(negative),
      reason: score >= threshold ? "matched_agri_keywords" : (negative.length ? "negative_keywords" : "low_agri_relevance")
    };
  }

  return {
    detect: detect,
    updateOptions: function (nextOptions) {
      nextOptions = nextOptions || {};
      if (nextOptions.baseKeywords) {
        baseKeywords = normalizeList(nextOptions.baseKeywords);
      }
    }
  };
}

module.exports = {
  createLiveRoomRelevanceDetector: createLiveRoomRelevanceDetector
};
