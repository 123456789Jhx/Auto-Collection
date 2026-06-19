function createScreenRecognizer(config, logger, ocrEngine, options) {
  options = options || {};
  var expectedPackage = options.expectedPackage || "com.ss.android.ugc.aweme";
  var autojsUtils = require(files.join(config.runtime.scriptDir, "utils/autojs-utils.js"));

  function safeString(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  function currentPackageName() {
    try {
      if (typeof currentPackage === "undefined") {
        return "";
      }
      return safeString(currentPackage());
    } catch (error) {
      return "";
    }
  }

  function currentActivityName() {
    try {
      if (typeof currentActivity === "undefined") {
        return "";
      }
      return safeString(currentActivity());
    } catch (error) {
      return "";
    }
  }

  function appendUnique(target, seen, value) {
    value = safeString(value).replace(/\s+/g, " ").trim();
    if (!value || seen[value]) {
      return;
    }
    seen[value] = true;
    target.push(value);
  }

  function appendSelectorValues(target, seen, selector, getterName, limit) {
    try {
      var nodes = selector.find();
      var count = typeof nodes.length === "number" ? nodes.length : (nodes.size ? nodes.size() : 0);
      count = Math.min(count, limit || 160);
      for (var i = 0; i < count; i++) {
        var node = typeof nodes.get === "function" ? nodes.get(i) : nodes[i];
        if (node && node[getterName]) {
          appendUnique(target, seen, node[getterName]());
        }
      }
    } catch (error) {
      if (logger && logger.debug) {
        logger.debug("screen text selector failed", { getter: getterName, message: String(error) });
      }
    }
  }

  function extractVisibleText() {
    var texts = [];
    var seen = {};
    appendSelectorValues(texts, seen, className("android.widget.TextView"), "text", 220);
    appendSelectorValues(texts, seen, textMatches(".+"), "text", 220);
    appendSelectorValues(texts, seen, descMatches(".+"), "desc", 220);
    return texts.join("\n");
  }

  function normalizeVisibleLines(text) {
    return safeString(text)
      .split(/\n+/)
      .map(function (line) {
        return line.replace(/\s+/g, "").trim();
      })
      .filter(function (line) {
        return line.length > 0;
      });
  }

  function hasStandaloneLine(text, word) {
    var lines = safeString(text).split(/\n+/);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].replace(/\s+/g, "") === word) {
        return true;
      }
    }
    return false;
  }

  function hasLineInFirst(lines, word, maxLines) {
    var limit = Math.min(lines.length, maxLines || lines.length);
    for (var i = 0; i < limit; i++) {
      if (lines[i] === word) {
        return true;
      }
    }
    return false;
  }

  function countLinesMatching(lines, pattern) {
    var count = 0;
    for (var i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        count += 1;
      }
    }
    return count;
  }

  function hasSearchTabCluster(text) {
    var tabWords = ["综合", "视频", "用户", "直播", "图文", "店铺", "团购"];
    var hitCount = 0;
    for (var i = 0; i < tabWords.length; i++) {
      if (hasStandaloneLine(text, tabWords[i])) {
        hitCount += 1;
      }
    }
    return hitCount >= 3;
  }

  function detectSearchPageState(visibleText, stateOptions) {
    stateOptions = stateOptions || {};
    var activeSearchKeyword = safeString(stateOptions.activeSearchKeyword);
    var state = {
      isResult: false,
      hasTabs: false,
      hasSearchHeader: false,
      durationCount: 0,
      dateCount: 0,
      keywordHit: false,
      resultScore: 0,
      reasons: []
    };
    if (!visibleText) {
      return state;
    }
    var lines = normalizeVisibleLines(visibleText);
    state.hasTabs = hasSearchTabCluster(visibleText);
    state.hasSearchHeader = hasLineInFirst(lines, "搜索", 8);
    state.durationCount = countLinesMatching(lines, /^\d{1,2}:\d{2}$/);
    state.dateCount = countLinesMatching(lines, /^(今天|昨天|前天|\d+\s*(分钟前|小时前|天前)|\d{1,2}\.\d{1,2}|\d{4}\.\d{1,2}\.\d{1,2})$/);
    state.keywordHit = !!(activeSearchKeyword && visibleText.indexOf(activeSearchKeyword) >= 0);

    if (state.hasTabs) {
      state.resultScore += 3;
      state.reasons.push("tabs");
    }
    if (state.hasSearchHeader) {
      state.resultScore += 2;
      state.reasons.push("search_header");
    }
    if (state.durationCount > 0) {
      state.resultScore += Math.min(3, state.durationCount);
      state.reasons.push("durations:" + state.durationCount);
    }
    if (state.dateCount > 0) {
      state.resultScore += Math.min(3, state.dateCount);
      state.reasons.push("dates:" + state.dateCount);
    }
    if (state.keywordHit) {
      state.resultScore += 1;
      state.reasons.push("keyword");
    }
    if (/相关搜索|筛选|最近看过/.test(visibleText)) {
      state.resultScore += 1;
      state.reasons.push("result_markers");
    }

    state.isResult =
      (state.hasTabs && /搜索/.test(visibleText)) ||
      (state.hasSearchHeader && state.durationCount >= 1 && (state.dateCount >= 1 || state.keywordHit)) ||
      (state.hasSearchHeader && state.durationCount >= 2);
    return state;
  }

  function isOverlayText(text) {
    if (!text) {
      return false;
    }
    return /同时发布为作品|发送\n购物|商品评价|期待你的评论|发条评论|评论 0|视频同款点这里|加入购物车|立即购买|我的订单|编辑主页|获赞\n|互关\n|粉丝\n|全部功能|选择音乐|分段拍|照片|相机|开直播|创作灵感|灵感跟拍|倒计时|闪光灯|翻转|发布作品/.test(text);
  }

  function isPublishPageText(text) {
    if (!text) {
      return false;
    }
    if (!/选择音乐|分段拍|照片|相机|创作灵感|灵感跟拍|倒计时|闪光灯|翻转|发布作品/.test(text)) {
      return false;
    }
    return hasStandaloneLine(text, "下一步") ||
      hasStandaloneLine(text, "发布") ||
      /选择音乐|分段拍|照片|相机|创作灵感|灵感跟拍|倒计时|闪光灯|翻转|发布作品/.test(text);
  }

  function isLiveRoomText(text, searchState) {
    if (!text || isOverlayText(text) || isPublishPageText(text)) {
      return false;
    }
    if ((searchState && searchState.isResult) || /综合\s*用户\s*视频|用户\s*视频\s*图文|搜索/.test(text)) {
      return false;
    }
    if (/首页\s*朋友\s*消息\s*我|朋友\s*消息\s*我|拍同款|共\d+人推荐|推荐\s*$/.test(text)) {
      return false;
    }
    if (/说点什么|欢迎来到直播间|小黄车|粉丝团|礼物|连麦|本场点赞|直播广场/.test(text)) {
      return true;
    }
    return /主播/.test(text) && /在线|粉丝团|礼物|说点什么|本场/.test(text);
  }

  function detectScene(snapshot, stateOptions) {
    var visibleText = snapshot.visibleText || "";
    var searchState = detectSearchPageState(visibleText, stateOptions);
    var reasons = [];
    var scene = "unknown";

    if (snapshot.currentPackageName && snapshot.currentPackageName !== expectedPackage) {
      return {
        scene: "outside_app",
        reasons: ["package:" + snapshot.currentPackageName],
        searchState: searchState
      };
    }
    if (isPublishPageText(visibleText)) {
      scene = "publish";
      reasons.push("publish_text");
    } else if (isOverlayText(visibleText)) {
      scene = "overlay";
      reasons.push("overlay_text");
    } else if (searchState.isResult) {
      scene = "search_result";
      reasons = reasons.concat(searchState.reasons);
    } else if (isLiveRoomText(visibleText, searchState)) {
      scene = "live_room";
      reasons.push("live_room_markers");
    } else if (/首页|朋友|消息|我|关注|推荐|分享|评论|点赞|展开|抖音/.test(visibleText)) {
      scene = "video_feed";
      reasons.push("feed_markers");
    }

    return {
      scene: scene,
      reasons: reasons,
      searchState: searchState
    };
  }

  function makeSnapshot(stateOptions) {
    var visibleText = extractVisibleText();
    var snapshot = {
      currentPackageName: currentPackageName(),
      currentActivityName: currentActivityName(),
      visibleText: visibleText,
      ocrText: "",
      ocrRegions: {},
      combinedText: visibleText,
      image: null,
      scene: "unknown",
      sceneReasons: [],
      searchState: null,
      capturedAt: new Date().toISOString()
    };
    var detected = detectScene(snapshot, stateOptions);
    snapshot.scene = detected.scene;
    snapshot.sceneReasons = detected.reasons;
    snapshot.searchState = detected.searchState;
    return snapshot;
  }

  function extractFastText(stateOptions) {
    return makeSnapshot(stateOptions);
  }

  function extractScreen(regionMap, stateOptions) {
    var screen = autojsUtils.getScreenSize();
    var width = screen.width;
    var height = screen.height;
    regionMap = regionMap || {
      title: {
        x: 0,
        y: Math.floor(height * 0.55),
        w: Math.floor(width * 0.78),
        h: Math.floor(height * 0.28)
      },
      subtitle: {
        x: Math.floor(width * 0.08),
        y: Math.floor(height * 0.35),
        w: Math.floor(width * 0.84),
        h: Math.floor(height * 0.22)
      },
      metrics: {
        x: Math.floor(width * 0.76),
        y: Math.floor(height * 0.35),
        w: Math.floor(width * 0.24),
        h: Math.floor(height * 0.45)
      }
    };

    var ocrResult = {
      image: null,
      regions: {},
      text: ""
    };
    try {
      ocrResult = ocrEngine.captureRegions(regionMap);
    } catch (error) {
      logger.warn("screen OCR snapshot failed, continue with accessibility text", { message: String(error) });
    }

    var snapshot = makeSnapshot(stateOptions);
    snapshot.image = ocrResult.image || null;
    snapshot.ocrText = ocrResult.text || "";
    snapshot.ocrRegions = ocrResult.regions || {};
    snapshot.combinedText = [snapshot.ocrText, snapshot.visibleText].filter(Boolean).join("\n");
    return snapshot;
  }

  function isSearchResultPage(text, stateOptions) {
    return detectSearchPageState(text || extractVisibleText(), stateOptions).isResult;
  }

  function isVideoPlaybackPage(stateOptions) {
    var snapshot = makeSnapshot(stateOptions);
    return snapshot.scene === "video_feed" || snapshot.scene === "live_room";
  }

  function isLiveRoomVisible(stateOptions) {
    var snapshot = makeSnapshot(stateOptions);
    return snapshot.scene === "live_room";
  }

  return {
    extractVisibleText: extractVisibleText,
    extractFastText: extractFastText,
    extractScreen: extractScreen,
    makeSnapshot: makeSnapshot,
    detectScene: detectScene,
    detectSearchPageState: detectSearchPageState,
    isSearchResultPage: isSearchResultPage,
    isVideoPlaybackPage: isVideoPlaybackPage,
    isLiveRoomVisible: isLiveRoomVisible,
    isOverlayText: isOverlayText,
    isPublishPageText: isPublishPageText,
    normalizeVisibleLines: normalizeVisibleLines,
    hasLineInFirst: hasLineInFirst,
    hasStandaloneLine: hasStandaloneLine,
    hasSearchTabCluster: hasSearchTabCluster
  };
}

module.exports = {
  createScreenRecognizer: createScreenRecognizer
};
