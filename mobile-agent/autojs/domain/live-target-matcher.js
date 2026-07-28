function normalizeLiveTargetText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/直播间|直播中|正在直播|直播|官方|专场/g, "")
    .replace(/[\s\-_·.。,:：，、/\\|[\]{}"'“”‘’!?！？]+/g, "")
    .trim();
}

function normalizeList(value) {
  if (typeof value === "string") {
    value = value.split(/[\n,，]/);
  }
  if (!value || !value.length) {
    return [];
  }
  var result = [];
  for (var i = 0; i < value.length; i++) {
    var text = String(value[i] && value[i].aliasText || value[i] || "").replace(/\s+/g, " ").trim();
    if (text) {
      result.push(text);
    }
  }
  return result;
}

function containsForbiddenKeyword(rawText, target) {
  var forbiddenKeywords = normalizeList(target && target.forbiddenKeywords);
  for (var i = 0; i < forbiddenKeywords.length; i++) {
    if (rawText.indexOf(forbiddenKeywords[i]) >= 0) {
      return forbiddenKeywords[i];
    }
  }
  return "";
}

function levenshtein(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }
  var prev = [];
  var curr = [];
  for (var j = 0; j <= b.length; j++) {
    prev[j] = j;
  }
  for (var i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (j = 1; j <= b.length; j++) {
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    var tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

function similarity(a, b) {
  a = normalizeLiveTargetText(a);
  b = normalizeLiveTargetText(b);
  if (!a || !b) {
    return 0;
  }
  if (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }
  var distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function collectNames(target) {
  var result = [];
  if (target && target.targetName) {
    result.push({ text: target.targetName, aliasText: "" });
  }
  var aliases = target && target.aliases || [];
  for (var i = 0; i < aliases.length; i++) {
    if (aliases[i] && aliases[i].enabled === false) {
      continue;
    }
    var aliasText = aliases[i] && aliases[i].aliasText || "";
    if (aliasText) {
      result.push({ text: aliasText, aliasText: aliasText });
    }
  }
  return result;
}

function thresholdOf(target) {
  var value = Number(target && target.similarityThreshold);
  if (!isFinite(value) || value <= 0) {
    return 0.9;
  }
  if (value > 1) {
    return Math.min(1, Math.max(0.5, value / 100));
  }
  return Math.min(1, Math.max(0.5, value));
}

function findBestLiveTargetMatch(candidateText, targets) {
  var rawText = String(candidateText || "");
  var normalizedCandidate = normalizeLiveTargetText(rawText);
  var best = {
    matched: false,
    reason: "below_threshold",
    similarity: 0
  };
  if (!normalizedCandidate || !targets || !targets.length) {
    return best;
  }

  for (var i = 0; i < targets.length; i++) {
    var target = targets[i] || {};
    if (target.enabled === false) {
      continue;
    }
    var forbidden = containsForbiddenKeyword(rawText, target);
    if (forbidden) {
      return {
        matched: false,
        reason: "forbidden_keyword",
        forbiddenKeyword: forbidden,
        targetCode: target.targetCode || "",
        targetName: target.targetName || ""
      };
    }
    var threshold = thresholdOf(target);
    var names = collectNames(target);
    for (var j = 0; j < names.length; j++) {
      var currentSimilarity = similarity(normalizedCandidate, names[j].text);
      if (currentSimilarity > best.similarity) {
        best = {
          matched: currentSimilarity >= threshold,
          reason: currentSimilarity >= threshold ? "matched" : "below_threshold",
          similarity: currentSimilarity,
          threshold: threshold,
          targetCode: target.targetCode || "",
          targetName: target.targetName || "",
          matchedAlias: names[j].aliasText || ""
        };
      }
    }
  }
  return best;
}

module.exports = {
  normalizeLiveTargetText: normalizeLiveTargetText,
  findBestLiveTargetMatch: findBestLiveTargetMatch,
  similarity: similarity
};
