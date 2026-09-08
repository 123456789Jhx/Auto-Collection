"use strict";

var layout = require("./douyin-layout.js");
var contract = require("../../core/action-contract.js");

var COMMENT_SWIPE_COUNT = 5;
var COMMENT_SEPARATOR_PATTERN = /[:：;；]/;
var COMMENT_FALLBACK_SEPARATOR_PATTERN = /[,，.。!！?？、…—~～\-()（）\[\]【】《》〈〉"'“”‘’·]/;
var COMMENT_SPECIAL_SYMBOL_PATTERN = /[|｜\\／/_＿@＠#＃$＄%％^＾&＆*＊+＋=＝<＜>＞{｛}｝`｀©®™￥¥€£]/;
var COMMENT_SWIPE_BASE_SCREEN = { width: 1080, height: 2248 };
var COMMENT_SWIPE_BASE_COORDINATES = {
  startX: 220,
  startY: 1587,
  endX: 220,
  endY: 1962
};

function screenDimensions(input) {
  input = input || {};
  var defaults = layout.DEFAULT_SCREEN_SIZE;
  return {
    width: Math.max(1, Math.floor(Number(input.width) || defaults.width)),
    height: Math.max(1, Math.floor(Number(input.height) || defaults.height))
  };
}

function commentOcrRegion(size) {
  var region = layout.getRegion("comment", screenDimensions(size));
  return { x: region.left, y: region.top, w: region.width, h: region.height };
}

function commentOcrRegions(size) {
  return { commentArea: commentOcrRegion(size) };
}

function commentSwipeCoordinates(size) {
  var screen = screenDimensions(size);
  var options = layout.SWIPE_OPTIONS;
  return {
    startX: Math.floor(COMMENT_SWIPE_BASE_COORDINATES.startX * screen.width / COMMENT_SWIPE_BASE_SCREEN.width),
    startY: Math.floor(COMMENT_SWIPE_BASE_COORDINATES.startY * screen.height / COMMENT_SWIPE_BASE_SCREEN.height),
    endX: Math.floor(COMMENT_SWIPE_BASE_COORDINATES.endX * screen.width / COMMENT_SWIPE_BASE_SCREEN.width),
    endY: Math.floor(COMMENT_SWIPE_BASE_COORDINATES.endY * screen.height / COMMENT_SWIPE_BASE_SCREEN.height),
    durationMs: options.durationMs
  };
}

function liveRoomSwipeCoordinates(size) {
  var screen = screenDimensions(size);
  var ratios = layout.SWIPE_RATIOS.up;
  var options = layout.SWIPE_OPTIONS;
  return {
    startX: Math.floor(screen.width * ratios.startX),
    startY: Math.floor(screen.height * options.liveRoomStartY),
    endX: Math.floor(screen.width * ratios.endX),
    endY: Math.floor(screen.height * options.liveRoomEndY),
    durationMs: options.durationMs
  };
}

function commentSeparatorIndex(line) {
  var primary = line.search(COMMENT_SEPARATOR_PATTERN);
  return primary >= 0 ? primary : line.search(COMMENT_FALLBACK_SEPARATOR_PATTERN);
}

function containsSpecialSymbol(value) {
  if (COMMENT_SPECIAL_SYMBOL_PATTERN.test(value)) return true;
  for (var index = 0; index < value.length; index += 1) {
    var code = value.charCodeAt(index);
    if (code < 32 || code === 127 ||
        code >= 0xD800 && code <= 0xDFFF ||
        code >= 0x20A0 && code <= 0x20CF ||
        code >= 0x2100 && code <= 0x214F ||
        code >= 0x2190 && code <= 0x2BFF ||
        code >= 0xFE00 && code <= 0xFE0F) return true;
  }
  return false;
}

function parseCommentLines(rawText) {
  var lines = String(rawText || "").split(/\r?\n/);
  var comments = [];
  var awaitingBody = false;
  for (var index = 0; index < lines.length; index += 1) {
    var line = lines[index];
    if (awaitingBody) {
      if (!line.trim()) continue;
      awaitingBody = false;
      var leadingSeparator = commentSeparatorIndex(line);
      var continuedText = (leadingSeparator === 0 ? line.slice(1) : line).trim();
      if (continuedText && !containsSpecialSymbol(continuedText)) {
        comments.push({ commentText: continuedText });
      }
      continue;
    }
    var separator = commentSeparatorIndex(line);
    if (separator < 0) continue;
    var commentText = line.slice(separator + 1).trim();
    if (!commentText) {
      awaitingBody = true;
      continue;
    }
    if (commentText && !containsSpecialSymbol(commentText)) comments.push({ commentText: commentText });
  }
  return comments;
}

function parseFilteredCommentLines(rawText) {
  return String(rawText || "").split(/\r?\n/).map(function (line) {
    return line.trim();
  }).filter(Boolean).map(function (commentText) {
    return { commentText: commentText };
  });
}

function flattenPages(pages) {
  var comments = [];
  (pages || []).forEach(function (page) {
    (page.comments || []).forEach(function (comment) {
      comments.push({
        pageIndex: page.pageIndex,
        commentText: comment.commentText
      });
    });
  });
  return comments;
}

function normalizedCommentKey(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function swipeAndCheckEnd(deps) {
  var driver = deps.driver, region = layout.getRegion("commentHistoryEnd", deps.screenSize);
  if (!driver || typeof driver.swipeAndHold !== "function") {
    return contract.failure("COMMENT_HOLD_UNAVAILABLE", "continuous accessibility gesture unavailable");
  }
  if (!deps.captureScreen || !deps.images || !deps.images.clip || !deps.ocrEngine || !deps.ocrEngine.recognize) {
    return contract.failure("COMMENT_END_OCR_UNAVAILABLE", "history-end OCR dependency missing");
  }
  var coordinates = commentSwipeCoordinates(deps.screenSize), attempts = 0, lastText = "";
  return driver.swipeAndHold({ points: [{ x: coordinates.startX, y: coordinates.startY },
    { x: coordinates.endX, y: coordinates.endY }], durationMs: coordinates.durationMs,
    holdMs: 2000, shouldStop: deps.shouldStop }, function (isHeld) {
    while (isHeld() && attempts < 20) {
      if (deps.shouldStop()) return contract.stopped();
      if (deps.sleep(100) === false) return contract.failure("COMMENT_HOLD_WAIT_FAILED", "hold wait failed");
      if (!isHeld()) break;
      var snapshot = null, image = null, clip = null;
      try {
        snapshot = deps.captureScreen();
        image = snapshot && snapshot.image ? snapshot.image : snapshot;
        if (!image) return contract.failure("COMMENT_END_OCR_FAILED", "empty screenshot");
        if (!isHeld()) {
          if (attempts) break;
          return contract.failure("COMMENT_END_CAPTURE_LATE", "screenshot arrived after release");
        }
        if (deps.shouldStop()) return contract.stopped();
        clip = deps.images.clip(image, region.left, region.top, region.width, region.height);
        if (!clip) return contract.failure("COMMENT_END_OCR_FAILED", "empty banner crop");
        lastText = String(deps.ocrEngine.recognize(clip) || "");
        attempts += 1;
        if (deps.shouldStop()) return contract.stopped();
        if (lastText.replace(/\s+/g, "").indexOf("没有更多信息了") >= 0) {
          return contract.success({ endDetected: true, text: lastText, attempts: attempts, region: region });
        }
      } catch (error) {
        return contract.failure("COMMENT_END_OCR_FAILED", String(error && error.message || error));
      } finally {
        try { if (clip && clip !== image && clip.recycle) clip.recycle(); }
        finally { if (image && image.recycle) image.recycle(); }
      }
    }
    return attempts ? contract.success({ endDetected: false, text: lastText, attempts: attempts, region: region })
      : contract.failure("COMMENT_END_CAPTURE_LATE", "no screenshot within hold window");
  });
}

function stableHash(value) {
  var hash = 2166136261;
  var text = String(value || "");
  for (var index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul ? Math.imul(hash, 16777619) : (hash * 16777619);
  }
  return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
}

function commentIdentity(scope, comment) {
  scope = scope || {};
  return "lc_" + stableHash([
    String(scope.batchId || ""),
    String(scope.deviceId || ""),
    String(scope.roomKey || ""),
    normalizedCommentKey(comment && comment.commentText)
  ].join("|"));
}

function buildCandidates(pages, scope) {
  scope = scope || {};
  var candidates = [];
  flattenPages(pages).forEach(function (comment, occurrenceIndex) {
    var normalized = normalizedCommentKey(comment.commentText);
    if (!normalized) return;
    var source = {
      deviceId: String(scope.deviceId || ""),
      roomKey: String(scope.roomKey || ""),
      pageIndex: comment.pageIndex,
      commentText: comment.commentText
    };
    if (scope.accountName) source.accountName = String(scope.accountName);
    if (scope.accountId) source.accountId = String(scope.accountId);
    var candidate = {
      batchId: String(scope.batchId || ""),
      deviceId: String(scope.deviceId || ""),
      roomKey: String(scope.roomKey || ""),
      pageIndex: comment.pageIndex,
      commentText: comment.commentText,
      sources: [source]
    };
    if (scope.accountName) candidate.accountName = String(scope.accountName);
    if (scope.accountId) candidate.accountId = String(scope.accountId);
    candidate.commentId = commentIdentity(scope, candidate) + "_" + occurrenceIndex;
    candidates.push(candidate);
  });
  return candidates;
}

function attachScope(comments, scope) {
  var pages = [];
  (comments || []).forEach(function (comment, index) {
    pages.push({
      pageIndex: comment.pageIndex === undefined ? index : comment.pageIndex,
      comments: [{ commentText: comment.commentText }]
    });
  });
  return buildCandidates(pages, scope);
}

module.exports = {
  COMMENT_SWIPE_COUNT: COMMENT_SWIPE_COUNT,
  COMMENT_SEPARATOR_PATTERN: COMMENT_SEPARATOR_PATTERN,
  commentOcrRegion: commentOcrRegion,
  commentOcrRegions: commentOcrRegions,
  commentSwipeCoordinates: commentSwipeCoordinates,
  liveRoomSwipeCoordinates: liveRoomSwipeCoordinates,
  parseCommentLines: parseCommentLines,
  parseFilteredCommentLines: parseFilteredCommentLines,
  flattenPages: flattenPages,
  normalizedCommentKey: normalizedCommentKey,
  swipeAndCheckEnd: swipeAndCheckEnd,
  commentIdentity: commentIdentity,
  attachScope: attachScope,
  buildCandidates: buildCandidates
};
