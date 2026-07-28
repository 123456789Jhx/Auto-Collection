function extractViewerScore(text) {
  var source = String(text || "");
  var score = 0;
  var match;
  var wanPattern = /(\d+(?:\.\d+)?)\s*万\s*(?:人|观看|在线|热度|人气|预约)?/g;
  while ((match = wanPattern.exec(source)) !== null) {
    var wanValue = Number(match[1] || 0);
    if (wanValue >= 1) {
      score = Math.max(score, 35);
    } else if (wanValue >= 0.3) {
      score = Math.max(score, 25);
    } else {
      score = Math.max(score, 15);
    }
  }

  var peoplePattern = /(\d{2,6})\s*(?:人|观看|在线|热度|人气|预约)/g;
  while ((match = peoplePattern.exec(source)) !== null) {
    var count = Number(match[1] || 0);
    if (count >= 10000) {
      score = Math.max(score, 35);
    } else if (count >= 3000) {
      score = Math.max(score, 25);
    } else if (count >= 500) {
      score = Math.max(score, 15);
    } else if (count >= 100) {
      score = Math.max(score, 8);
    }
  }

  return score;
}

function createLiveScorer(config) {
  function hasStrongLiveEntryText(text) {
    return /点击进入直播间|进入直播间|讲解中|热聊中|正在直播|直播中|直播间/.test(text);
  }

  function scoreLiveCandidate(text, matchResult) {
    var score = 0;
    var reasons = [];
    var agricultureHits = matchResult.agricultureHits || [];
    var liveHits = matchResult.liveHits || [];
    var marketingHits = matchResult.marketingHits || [];
    var lowPriorityHits = matchResult.lowPriorityHits || [];
    var viewerScore = extractViewerScore(text);

    if (agricultureHits.length > 0) {
      score += agricultureHits.length >= 2 ? 45 : 28;
      reasons.push("agriculture:" + agricultureHits.join(","));
    }
    if (matchResult.priority === "high") {
      score += 15;
      reasons.push("high_agri_match");
    }
    var strongLiveEntry = hasStrongLiveEntryText(text);
    if (liveHits.length > 0) {
      score += strongLiveEntry ? 20 : 5;
      reasons.push((strongLiveEntry ? "live:" : "live_hint:") + liveHits.join(","));
    }
    if (/点击进入直播间|进入直播间/.test(text)) {
      score += 20;
      reasons.push("entry_text");
    }
    if (/讲解中|热聊中|正在直播|直播中/.test(text)) {
      score += 10;
      reasons.push("active_live");
    }
    var hasLiveEntry = strongLiveEntry;
    if (!hasLiveEntry) {
      reasons.push("no_live_entry");
    }
    if (viewerScore > 0) {
      score += viewerScore;
      reasons.push("viewer_score:" + viewerScore);
    }
    if (marketingHits.length > 0) {
      score -= 25;
      reasons.push("marketing:" + marketingHits.join(","));
    }
    if (lowPriorityHits.length > 0) {
      score -= 30;
      reasons.push("low_priority:" + lowPriorityHits.join(","));
    }
    if (/游戏|手游|明星|演唱会|汽车|美业|美容|团购|景区|穿搭|电影|电视剧/.test(text) && agricultureHits.length < 2) {
      score -= 25;
      reasons.push("non_agri_context");
    }

    var quality = "low";
    if (score >= 95) {
      quality = "high";
    } else if (score >= 70) {
      quality = "normal";
    }

    return {
      score: score,
      quality: quality,
      shouldEnter: score >= config.task.liveCandidateMinScore && agricultureHits.length > 0 && hasLiveEntry,
      reasons: reasons,
      viewerScore: viewerScore,
      agricultureHits: agricultureHits,
      liveHits: liveHits,
      hasLiveEntry: hasLiveEntry
    };
  }

  return {
    scoreLiveCandidate: scoreLiveCandidate
  };
}

module.exports = {
  createLiveScorer: createLiveScorer
};
