function normalizeLine(line) {
  return String(line || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isNoiseLine(line) {
  if (!line) {
    return true;
  }
  if (/^(首页|朋友|消息|我|推荐|关注|商城|同城|直播|热点|团购|游戏|明星|聊天|搜索|取消)$/.test(line)) {
    return true;
  }
  if (/^(说点什么|直播广场|粉丝团|礼物|连麦|分享|上滑看更多直播)$/.test(line)) {
    return true;
  }
  if (/^(广告|隐私政策|用户协议|抖音安全中心)$/.test(line)) {
    return true;
  }
  if (/^\d+(\.\d+)?[wW万亿]?$/.test(line)) {
    return true;
  }
  return false;
}

function parseColonComment(line) {
  var match = line.match(/^(.{1,32}?)[：:]\s*(.+)$/);
  if (!match) {
    return null;
  }
  return {
    authorName: normalizeLine(match[1]),
    content: normalizeLine(match[2])
  };
}

function parseSpaceComment(line) {
  var match = line.match(/^([A-Za-z0-9_\-\u4e00-\u9fa5.]{1,24})\s+(.{1,100})$/);
  if (!match) {
    return null;
  }
  return {
    authorName: normalizeLine(match[1]),
    content: normalizeLine(match[2])
  };
}

function looksLikeComment(line) {
  if (parseColonComment(line) || parseSpaceComment(line)) {
    return true;
  }
  if (/(关注了主播|关注了你|关注了TA|关注了该直播间|成为了粉丝|进入了?直播间|来到直播间|来了|分享了直播|为主播点赞了|帮主播充能)/.test(line)) {
    return true;
  }
  return /[\u4e00-\u9fa5]/.test(line) && line.length >= 3 && line.length <= 80;
}

function buildComment(line, rawLine) {
  var parsed = parseColonComment(line) || parseSpaceComment(line) || {};
  return {
    text: line,
    raw: rawLine,
    authorName: parsed.authorName || "",
    content: parsed.content || line,
    source: "visible_text"
  };
}

function createLiveCommentReader(options) {
  var maxLines = Number((options && options.maxLines) || 80);

  function readFromText(text) {
    var rawLines = String(text || "").split(/\n+/);
    var comments = [];
    var seen = {};

    for (var i = 0; i < rawLines.length; i++) {
      var line = normalizeLine(rawLines[i]);
      if (isNoiseLine(line) || !looksLikeComment(line)) {
        continue;
      }
      if (seen[line]) {
        continue;
      }
      seen[line] = true;
      comments.push(buildComment(line, rawLines[i]));
      if (comments.length >= maxLines) {
        break;
      }
    }

    return comments;
  }

  return {
    readFromText: readFromText
  };
}

module.exports = {
  createLiveCommentReader: createLiveCommentReader
};
