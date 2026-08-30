"use strict";

var layout = require("./douyin-layout.js");

var COMMENT_SWIPE_COUNT = 5;
var COMMENT_SEPARATOR_PATTERN = /[:：]/;

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
  var region = commentOcrRegion(size);
  var options = layout.SWIPE_OPTIONS;
  var centerRatio = layout.SWIPE_RATIOS.up.startX;
  return {
    startX: Math.floor(region.x + region.w * centerRatio),
    startY: Math.floor(region.y + region.h * options.commentStartY),
    endX: Math.floor(region.x + region.w * centerRatio),
    endY: Math.floor(region.y + region.h * options.commentEndY),
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

function compactText(value) {
  return String(value || "")
    .replace(/[\u00a0\t ]+/g, "")
    .replace(/^[-*·•]+/, "")
    .trim();
}

function isNoiseLine(value) {
  return /^(说点什么|发条评论|欢迎来到直播间|直播已结束|全部评论|查看更多|分享|点赞|关注|礼物|连麦)$/.test(value) ||
    /(?:来了|进入直播间|加入直播间|送出|赠送礼物)$/.test(value);
}

function parseCommentLines(rawText) {
  var lines = String(rawText || "").split(/\r?\n/);
  var comments = [];
  var current = null;

  function flush() {
    if (!current || !current.userName || !current.commentText) {
      current = null;
      return;
    }
    comments.push({
      userName: current.userName.slice(0, 80),
      commentText: current.commentText.slice(0, 200)
    });
    current = null;
  }

  for (var index = 0; index < lines.length; index += 1) {
    var line = compactText(lines[index]);
    if (!line) continue;
    var separator = line.search(COMMENT_SEPARATOR_PATTERN);
    if (separator > 0) {
      flush();
      var userName = compactText(line.slice(0, separator));
      var commentText = compactText(line.slice(separator + 1));
      if (userName && commentText) {
        current = { userName: userName, commentText: commentText };
      }
      continue;
    }
    if (isNoiseLine(line)) continue;
    if (current && line.length <= 120 && !/^[0-9]+$/.test(line)) {
      current.commentText += line;
    }
  }
  flush();
  return comments;
}

function flattenPages(pages) {
  var comments = [];
  (pages || []).forEach(function (page) {
    (page.comments || []).forEach(function (comment) {
      comments.push({
        pageIndex: page.pageIndex,
        userName: comment.userName,
        commentText: comment.commentText
      });
    });
  });
  return comments;
}

function normalizedCommentKey(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
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
  var byText = {};
  flattenPages(pages).forEach(function (comment) {
    var normalized = normalizedCommentKey(comment.commentText);
    if (!normalized || normalized.length > 100) return;
    var key = "comment:" + normalized;
    var source = {
      deviceId: String(scope.deviceId || ""),
      roomKey: String(scope.roomKey || ""),
      pageIndex: comment.pageIndex,
      userName: comment.userName,
      commentText: comment.commentText
    };
    var existing = byText[key];
    if (existing) {
      existing.sources.push(source);
      return;
    }
    var candidate = {
      batchId: String(scope.batchId || ""),
      deviceId: String(scope.deviceId || ""),
      roomKey: String(scope.roomKey || ""),
      pageIndex: comment.pageIndex,
      userName: comment.userName,
      commentText: comment.commentText,
      sources: [source]
    };
    candidate.commentId = commentIdentity(scope, candidate);
    byText[key] = candidate;
    candidates.push(candidate);
  });
  return candidates;
}

function attachScope(comments, scope) {
  var pages = [];
  (comments || []).forEach(function (comment, index) {
    pages.push({
      pageIndex: comment.pageIndex === undefined ? index : comment.pageIndex,
      comments: [{ userName: comment.userName, commentText: comment.commentText }]
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
  flattenPages: flattenPages,
  normalizedCommentKey: normalizedCommentKey,
  commentIdentity: commentIdentity,
  attachScope: attachScope,
  buildCandidates: buildCandidates
};
