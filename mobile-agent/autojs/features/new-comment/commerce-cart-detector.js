"use strict";

function readSimilarity(result) {
  var candidates = [];
  if (result && result.best) candidates.push(result.best);
  if (result && result.first) candidates.push(result.first);
  if (result && Array.isArray(result.matches)) candidates = candidates.concat(result.matches);
  var best = null;
  candidates.forEach(function (candidate) {
    if (!candidate) return;
    var value = Number(candidate.similarity !== undefined ? candidate.similarity :
      candidate.score !== undefined ? candidate.score : candidate.value);
    if (isFinite(value) && (best === null || value > best)) best = value;
  });
  if (best !== null) return best;
  var direct = Number(result && (result.similarity !== undefined ? result.similarity : result.score));
  return isFinite(direct) ? direct : 0;
}

function matchCommerceCart(imageApi, screenshot, template, region, threshold) {
  threshold = isFinite(Number(threshold)) ? Number(threshold) : 0.5;
  if (!imageApi || typeof imageApi.clip !== "function" || typeof imageApi.matchTemplate !== "function" || !screenshot || !template) {
    return { detected: false, similarity: 0, reason: "TEMPLATE_MATCH_UNAVAILABLE" };
  }
  var clipped = null;
  try {
    clipped = imageApi.clip(screenshot, region.left, region.top, region.width, region.height);
    var result = imageApi.matchTemplate(clipped, template, { threshold: 0 });
    var similarity = readSimilarity(result);
    return { detected: similarity >= threshold, similarity: similarity };
  } catch (error) {
    return { detected: false, similarity: 0, reason: "TEMPLATE_MATCH_FAILED", message: String(error && error.message || error) };
  } finally {
    if (clipped && typeof clipped.recycle === "function") clipped.recycle();
  }
}

module.exports = { matchCommerceCart: matchCommerceCart };
