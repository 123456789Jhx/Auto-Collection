var TYPE_VIEWER_COMMENT = "viewer_comment";
var TYPE_VIEWER_ENTER = "viewer_enter";
var TYPE_FOLLOW_EVENT = "follow_event";
var TYPE_ROOM_NOTICE = "room_notice";
var TYPE_SYSTEM_NOTICE = "system_notice";
var TYPE_UNKNOWN = "unknown";

var DEFAULT_OPTIONS = {
  minCommentLength: 1,
  maxCommentLength: 120
};

function mergeOptions(options) {
  var merged = {};
  var key;
  for (key in DEFAULT_OPTIONS) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_OPTIONS, key)) {
      merged[key] = DEFAULT_OPTIONS[key];
    }
  }
  options = options || {};
  for (key in options) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      merged[key] = options[key];
    }
  }
  return merged;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickText(input) {
  if (typeof input === "string") {
    return input;
  }
  if (!input) {
    return "";
  }
  return input.text || input.raw || input.content || "";
}

function isNavigationNoise(text) {
  if (!text) {
    return true;
  }
  if (/^\d+$/.test(text)) {
    return true;
  }
  if (/^\d+(\.\d+)?[wW万亿]?$/.test(text)) {
    return true;
  }
  return /^(首页|朋友|消息|我|推荐|关注|商城|同城|直播|热点|团购|游戏|明星|聊天|搜索|取消|分享|礼物|连麦)$/.test(text);
}

function isCommentContentNoise(text) {
  if (!text) {
    return true;
  }
  return /^(首页|朋友|消息|我|推荐|关注|商城|同城|直播|热点|团购|游戏|明星|聊天|搜索|取消|分享|礼物|连麦)$/.test(text);
}

function classifySystemNotice(text) {
  if (/(登录|验证码|安全验证|实名认证|权限|网络异常|连接失败|请求失败|重试|服务异常|系统繁忙|操作频繁|违规|封禁|禁言|风险|风控|青少年模式|直播已结束|主播暂时离开|内容暂不可见|该直播间不存在)/.test(text)) {
    return {
      type: TYPE_SYSTEM_NOTICE,
      confidence: 0.96,
      matchedRule: "system_notice_guard"
    };
  }
  if (/^(系统通知|温馨提示|提示|抖音安全中心)[:：\s]/.test(text)) {
    return {
      type: TYPE_SYSTEM_NOTICE,
      confidence: 0.94,
      matchedRule: "system_notice_prefix"
    };
  }
  return null;
}

function classifyViewerEnter(text) {
  var match = text.match(/^(欢迎\s*)?(.{1,32}?)(进入了?直播间|来到直播间|来了)$/);
  if (match) {
    return {
      type: TYPE_VIEWER_ENTER,
      confidence: 0.9,
      matchedRule: "viewer_enter_suffix",
      fields: {
        nickname: normalizeText(match[2])
      }
    };
  }
  if (/进入直播间/.test(text) && text.length <= 45) {
    return {
      type: TYPE_VIEWER_ENTER,
      confidence: 0.82,
      matchedRule: "viewer_enter_short"
    };
  }
  return null;
}

function classifyFollowEvent(text) {
  var match = text.match(/^(.{1,32}?)(关注了主播|关注了你|关注了TA|关注了该直播间|成为了粉丝)$/);
  if (match) {
    return {
      type: TYPE_FOLLOW_EVENT,
      confidence: 0.92,
      matchedRule: "follow_event_suffix",
      fields: {
        nickname: normalizeText(match[1])
      }
    };
  }
  if (/(感谢关注|谢谢关注)/.test(text) && text.length <= 60) {
    return {
      type: TYPE_FOLLOW_EVENT,
      confidence: 0.72,
      matchedRule: "follow_event_thanks"
    };
  }
  return null;
}

function classifyRoomNotice(text) {
  if (/(欢迎来到直播间|严禁|理性消费|谨防诈骗|本场点赞|上滑看更多直播|点击进入直播间|主播正在讲解|商品讲解|购物车|粉丝团|福袋|红包|抽奖|连麦申请|管理员|直播间公告|主播公告|房间公告)/.test(text)) {
    return {
      type: TYPE_ROOM_NOTICE,
      confidence: 0.88,
      matchedRule: "room_notice_keywords"
    };
  }
  if (/^(公告|主播公告|管理员|房管|直播间)[:：\s]/.test(text)) {
    return {
      type: TYPE_ROOM_NOTICE,
      confidence: 0.9,
      matchedRule: "room_notice_prefix"
    };
  }
  return null;
}

function extractColonComment(text) {
  var match = text.match(/^(.{1,32}?)[：:]\s*(.+)$/);
  if (!match) {
    return null;
  }
  return {
    nickname: normalizeText(match[1]),
    content: normalizeText(match[2])
  };
}

function extractSpaceComment(text) {
  var match = text.match(/^([A-Za-z0-9_\-\u4e00-\u9fa5.]{1,24})\s+(.{1,100})$/);
  if (!match) {
    return null;
  }
  return {
    nickname: normalizeText(match[1]),
    content: normalizeText(match[2])
  };
}

function isEventLikeText(text) {
  return /(进入了?直播间|来到直播间|来了|关注了|直播间公告|系统通知|温馨提示)/.test(text);
}

function classifyViewerComment(text, options) {
  var parsed = extractColonComment(text);
  var confidence = 0.86;
  var matchedRule = "viewer_comment_colon";

  if (!parsed) {
    parsed = extractSpaceComment(text);
    confidence = 0.68;
    matchedRule = "viewer_comment_space";
  }

  if (parsed) {
    if (!parsed.content || parsed.content.length < options.minCommentLength || parsed.content.length > options.maxCommentLength) {
      return null;
    }
    if (isNavigationNoise(parsed.nickname) || isCommentContentNoise(parsed.content) || isEventLikeText(text)) {
      return null;
    }
    return {
      type: TYPE_VIEWER_COMMENT,
      confidence: confidence,
      matchedRule: matchedRule,
      fields: parsed
    };
  }

  if (text.length >= options.minCommentLength && text.length <= options.maxCommentLength && !isNavigationNoise(text) && !isEventLikeText(text)) {
    return {
      type: TYPE_VIEWER_COMMENT,
      confidence: 0.52,
      matchedRule: "viewer_comment_plain_text",
      fields: {
        content: text
      }
    };
  }

  return null;
}

function buildResult(input, type, confidence, matchedRule, fields) {
  var text = normalizeText(pickText(input));
  return {
    type: type,
    text: text,
    rawText: typeof input === "string" ? input : (input && (input.raw || input.text || input.content)) || "",
    confidence: confidence,
    matchedRule: matchedRule,
    fields: fields || {}
  };
}

function classifyOne(input, options) {
  options = mergeOptions(options);
  var text = normalizeText(pickText(input));
  var result;

  if (isNavigationNoise(text)) {
    return buildResult(input, TYPE_UNKNOWN, 0.3, "navigation_or_empty", {});
  }

  result = classifySystemNotice(text) ||
    classifyViewerEnter(text) ||
    classifyFollowEvent(text) ||
    classifyRoomNotice(text) ||
    classifyViewerComment(text, options);

  if (result) {
    return buildResult(input, result.type, result.confidence, result.matchedRule, result.fields);
  }

  return buildResult(input, TYPE_UNKNOWN, 0.35, "no_rule_matched", {});
}

function createLiveCommentClassifier(options) {
  var defaultOptions = mergeOptions(options);

  function resolveOptions(overrideOptions) {
    var resolved = mergeOptions(defaultOptions);
    overrideOptions = overrideOptions || {};
    for (var key in overrideOptions) {
      if (Object.prototype.hasOwnProperty.call(overrideOptions, key)) {
        resolved[key] = overrideOptions[key];
      }
    }
    return resolved;
  }

  function classify(input, overrideOptions) {
    return classifyOne(input, resolveOptions(overrideOptions));
  }

  function classifyMany(items, overrideOptions) {
    var list = items || [];
    var results = [];
    var resolvedOptions = resolveOptions(overrideOptions);
    for (var i = 0; i < list.length; i++) {
      results.push(classifyOne(list[i], resolvedOptions));
    }
    return results;
  }

  return {
    classify: classify,
    classifyMany: classifyMany
  };
}

module.exports = {
  TYPE_VIEWER_COMMENT: TYPE_VIEWER_COMMENT,
  TYPE_VIEWER_ENTER: TYPE_VIEWER_ENTER,
  TYPE_FOLLOW_EVENT: TYPE_FOLLOW_EVENT,
  TYPE_ROOM_NOTICE: TYPE_ROOM_NOTICE,
  TYPE_SYSTEM_NOTICE: TYPE_SYSTEM_NOTICE,
  TYPE_UNKNOWN: TYPE_UNKNOWN,
  classifyLiveComment: classifyOne,
  createLiveCommentClassifier: createLiveCommentClassifier
};
