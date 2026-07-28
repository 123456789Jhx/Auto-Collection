function normalizeText(text) {
  return String(text || "").replace(/\r/g, "\n");
}

function hasAny(text, patterns) {
  for (var i = 0; i < patterns.length; i++) {
    if (patterns[i].test(text)) {
      return true;
    }
  }
  return false;
}

function createLiveRoomDetector(options) {
  var expectedPackage = (options && options.expectedPackage) || "com.ss.android.ugc.aweme";

  function detect(text, meta) {
    var source = normalizeText(text);
    var currentPackageName = meta && meta.currentPackageName;
    var reasons = [];

    if (currentPackageName && currentPackageName !== expectedPackage) {
      return {
        state: "outside_douyin",
        readyForCommentRead: false,
        reasons: ["package:" + currentPackageName]
      };
    }

    if (hasAny(source, [/验证码|安全验证|完成验证|请完成验证/, /账号异常|操作过于频繁|稍后再试/, /登录|手机号登录|密码登录/])) {
      return {
        state: "blocked",
        readyForCommentRead: false,
        reasons: ["risk_or_login"]
      };
    }

    if (hasAny(source, [/自动进入直播间/, /上滑看更多直播/, /取消/]) && hasAny(source, [/直播间|更多直播/])) {
      reasons.push("auto_enter_overlay");
      return {
        state: "live_auto_entering",
        readyForCommentRead: false,
        reasons: reasons
      };
    }

    if (hasAny(source, [/说点什么/, /欢迎来到直播间/, /本场点赞/, /直播广场/, /为主播点赞了/, /关注了主播/, /分享了直播/])) {
      reasons.push("live_comment_surface");
      if (hasAny(source, [/主播|直播广场|粉丝团|礼物|连麦|在线|本场|欢迎来到直播间/])) {
        reasons.push("live_room_markers");
      }
      return {
        state: "live_room",
        readyForCommentRead: true,
        reasons: reasons
      };
    }

    if (hasAny(source, [/点击进入直播间/, /观看记录/, /直播中/, /带货中/, /正在直播/, /已选中，直播，按钮/])) {
      reasons.push("live_feed_markers");
      return {
        state: "live_feed",
        readyForCommentRead: false,
        reasons: reasons
      };
    }

    if (hasAny(source, [/首页|朋友|消息|我/]) && hasAny(source, [/推荐|关注|商城|同城/])) {
      reasons.push("douyin_feed_markers");
      return {
        state: "douyin_feed",
        readyForCommentRead: false,
        reasons: reasons
      };
    }

    return {
      state: "unknown",
      readyForCommentRead: false,
      reasons: ["no_live_marker"]
    };
  }

  return {
    detect: detect
  };
}

module.exports = {
  createLiveRoomDetector: createLiveRoomDetector
};
