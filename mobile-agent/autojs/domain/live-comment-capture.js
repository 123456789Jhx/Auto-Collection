// 评论采集 MVP 的纯函数：只处理评论红框几何和“用户名：正文”解析。

var COMMENT_SWIPE_COUNT = 5;
var COMMENT_REGION = {
  left: 0.055,
  top: 0.622,
  width: 0.855,
  height: 0.247
};

function screenDimensions(input) {
  input = input || {};
  return {
    width: Math.max(1, Math.floor(Number(input.width) || 1080)),
    height: Math.max(1, Math.floor(Number(input.height) || 2400))
  };
}

function boundedRegion(x, y, width, height, screen) {
  var left = Math.max(0, Math.min(screen.width - 1, Math.floor(x)));
  var top = Math.max(0, Math.min(screen.height - 1, Math.floor(y)));
  var right = Math.max(left + 1, Math.min(screen.width, Math.ceil(x + width)));
  var bottom = Math.max(top + 1, Math.min(screen.height, Math.ceil(y + height)));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function commentOcrRegion(size) {
  var screen = screenDimensions(size);
  return boundedRegion(
    screen.width * COMMENT_REGION.left,
    screen.height * COMMENT_REGION.top,
    screen.width * COMMENT_REGION.width,
    screen.height * COMMENT_REGION.height,
    screen
  );
}

function commentOcrRegions(size) {
  return { commentArea: commentOcrRegion(size) };
}

function commentSwipeCoordinates(size) {
  var region = commentOcrRegion(size);
  return {
    startX: Math.floor(region.x + region.w * 0.5),
    startY: Math.floor(region.y + region.h * 0.82),
    endX: Math.floor(region.x + region.w * 0.5),
    endY: Math.floor(region.y + region.h * 0.18),
    durationMs: 520
  };
}

function liveRoomSwipeCoordinates(size) {
  var screen = screenDimensions(size);
  return {
    startX: Math.floor(screen.width * 0.5),
    startY: Math.floor(screen.height * 0.78),
    endX: Math.floor(screen.width * 0.5),
    endY: Math.floor(screen.height * 0.22),
    durationMs: 520
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
    var separator = line.search(/[:：]/);
    if (separator > 0) {
      flush();
      var userName = compactText(line.slice(0, separator));
      var commentText = compactText(line.slice(separator + 1));
      // Once a colon identifies the username boundary, keep the entire user
      // supplied text; phrases such as "来了" are valid comment content.
      if (userName && commentText) {
        current = { userName: userName, commentText: commentText };
      }
      continue;
    }

    if (isNoiseLine(line)) continue;
    // OCR 可能把一条长评论拆成两行；仅把明显不是系统提示的续行接回上一条。
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

// Candidate ids do not depend on the OCR page or username. The same comment
// body therefore keeps one id when it is visible on adjacent pages.
function commentIdentity(scope, comment) {
  scope = scope || {};
  var batchId = String(scope.batchId || "");
  var deviceId = String(scope.deviceId || "");
  var roomKey = String(scope.roomKey || "");
  var commentText = normalizedCommentKey(comment && comment.commentText);
  return "lc_" + stableHash([batchId, deviceId, roomKey, commentText].join("|"));
}

function buildCandidates(pages, scope) {
  scope = scope || {};
  var candidates = [];
  var byText = {};
  flattenPages(pages).forEach(function (comment) {
    var normalized = normalizedCommentKey(comment.commentText);
    if (!normalized) return;
    var key = "comment:" + normalized;
    var source = {
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
