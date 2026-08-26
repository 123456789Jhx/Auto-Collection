function normalizeDigits(value) {
  var normalized = String(value || "").replace(/[,，\s]/g, "");
  return normalized ? Number(normalized) : null;
}

function parseViewerCount(text) {
  var source = String(text || "");
  var wanMatch;
  var peopleMatch;
  var labeledMatch;
  var count;
  var wanPattern = /(\d+(?:\.\d+)?)\s*[万wW]\s*(?:人|在线|观看|热度|人气)?/g;
  var peoplePattern = /(\d[\d,，\s]{0,7})\s*(?:人|在线|观看|热度|人气)/g;
  var labeledPattern = /(?:在线|观看|人数|热度|人气)\s*[:：]?\s*(\d[\d,，\s]{0,7})/g;
  var result = null;

  while ((wanMatch = wanPattern.exec(source)) !== null) {
    count = Number(wanMatch[1]) * 10000;
    if (isFinite(count)) result = Math.max(result === null ? 0 : result, Math.round(count));
  }
  while ((peopleMatch = peoplePattern.exec(source)) !== null) {
    count = normalizeDigits(peopleMatch[1]);
    if (count !== null && isFinite(count)) result = Math.max(result === null ? 0 : result, count);
  }
  while ((labeledMatch = labeledPattern.exec(source)) !== null) {
    count = normalizeDigits(labeledMatch[1]);
    if (count !== null && isFinite(count)) result = Math.max(result === null ? 0 : result, count);
  }
  return result;
}

function parseViewerBadgeCount(text) {
  var parsed = parseViewerCount(text);
  if (parsed !== null) return parsed;
  // Only use this parser for the dedicated top-right viewer badge crop.
  // A bare number elsewhere can be a comment, like count, or product price.
  var compact = String(text || "").replace(/[\s,，>›]/g, "");
  if (!/^\d{1,7}$/.test(compact)) return null;
  var count = Number(compact);
  return isFinite(count) ? count : null;
}

module.exports = {
  parseViewerCount: parseViewerCount,
  parseViewerBadgeCount: parseViewerBadgeCount
};
