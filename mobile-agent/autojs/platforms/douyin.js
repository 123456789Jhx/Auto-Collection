function createDouyinAdapter(config, logger, ocrEngine, floatyControl) {
  var autojsUtils = require(files.join(config.runtime.scriptDir, "utils/autojs-utils.js"));
  var packageName = "com.ss.android.ugc.aweme";
  var activeSearchKeyword = "";

  function avoidFloaty(reason) {
    try {
      if (floatyControl && floatyControl.moveToSafeCorner) {
        floatyControl.moveToSafeCorner(reason || "douyin_action");
      }
    } catch (error) {
      logger.warn("floaty avoid failed", { reason: reason || "", message: String(error) });
    }
  }

  function dismissStartupPopups() {
    autojsUtils.clickIfExists(textMatches(/.*(允许).*/).clickable(true), 800, logger);

    var starCardNode =
      autojsUtils.waitForElement(textContains("玩转抖音星卡"), 500, null, logger) ||
      autojsUtils.waitForElement(descContains("玩转抖音星卡"), 500, null, logger);
    if (starCardNode) {
      logger.warn("检测到抖音活动 WebView，尝试返回首页");
      back();
      autojsUtils.sleepRandom(600, 1000);
    }

    var tipNode = autojsUtils.waitForElement(text("温馨提示"), 700, null, logger);
    if (tipNode) {
      var screen = autojsUtils.getScreenSize();
      autojsUtils.clickPoint(screen.width / 2, screen.height * 0.85);
    }

    var continueEditNode = autojsUtils.waitForElement(text("继续编辑作品吗？"), 700, null, logger);
    if (continueEditNode) {
      autojsUtils.clickIfExists(desc("取消"), 600, logger);
      autojsUtils.clickIfExists(text("取消"), 600, logger);
    }
  }

  function allowCrossAppLaunchIfPrompted(timeoutMs) {
    var endTime = Date.now() + (timeoutMs || 5000);
    var allowed = false;
    while (Date.now() <= endTime) {
      var promptNode =
        autojsUtils.waitForElement(textContains("启动应用"), 300, null, null) ||
        autojsUtils.waitForElement(textContains("想要打开"), 300, null, null);
      if (promptNode) {
        allowed =
          autojsUtils.clickIfExists(textMatches(/^(允许|始终允许)$/).clickable(true), 800, logger) ||
          autojsUtils.clickIfExists(textContains("允许").clickable(true), 800, logger);
        if (allowed) {
          autojsUtils.sleepRandom(800, 1200);
          return true;
        }
      }
      sleep(300);
    }
    return allowed;
  }

  function ensureDouyinForeground() {
    var current = currentPackage();
    if (current !== packageName) {
      logger.warn("当前应用不是抖音", { expectedPackage: packageName, actualPackage: current });
      return false;
    }
    return true;
  }

  function openApp() {
    logger.info("打开抖音");
    home();
    autojsUtils.sleepRandom(500, 900);

    var launched = app.launchPackage(packageName);
    if (!launched) {
      throw new Error("抖音打开失败，未找到包名：" + packageName);
    }

    allowCrossAppLaunchIfPrompted(6000);
    autojsUtils.sleepRandom(1200, 2200);
    dismissStartupPopups();
    autojsUtils.sleepRandom(600, 1200);
    ensureDouyinForeground();

    var homeNode =
      autojsUtils.waitForElement(text("首页"), 2500, null, logger) ||
      autojsUtils.waitForElement(desc("首页"), 1000, null, logger);
    if (!homeNode) {
      logger.warn("未检测到抖音首页控件，继续尝试执行");
    }
    return !!launched;
  }

  function openSearch(keyword) {
    logger.info("尝试进入抖音搜索", { keyword: keyword });
    ensureDouyinForeground();
    avoidFloaty("open_search");
    var previousSearchKeyword = activeSearchKeyword;
    logger.info("搜索流程诊断：初始屏幕状态", {
      keyword: keyword,
      screen: autojsUtils.describeScreenSize(),
      textSample: extractVisibleText().slice(0, 180)
    });

    var searchNode =
      autojsUtils.waitForElement(desc("搜索"), 1200, null, logger) ||
      autojsUtils.waitForElement(descContains("搜索"), 800, null, logger) ||
      autojsUtils.waitForElement(text("搜索"), 800, null, logger) ||
      autojsUtils.waitForElement(textContains("搜索"), 800, null, logger);

    if (searchNode) {
      focusSearchInput(searchNode);
      autojsUtils.sleepRandom(600, 1000);
      setText(keyword);
      activeSearchKeyword = keyword || previousSearchKeyword;
      autojsUtils.sleepRandom(500, 800);
      logger.info("搜索流程诊断：关键词已输入", {
        keyword: keyword,
        screen: autojsUtils.describeScreenSize(),
        textSample: extractVisibleText().slice(0, 220)
      });

      submitSearchKeyword(keyword);
      var submittedText = extractVisibleText();
      var submittedState = detectSearchPageState(submittedText);
      logger.info("搜索流程诊断：提交后页面状态", {
        keyword: keyword,
        isSearchResultPage: submittedState.isResult,
        searchState: submittedState,
        screen: autojsUtils.describeScreenSize(),
        textSample: submittedText.slice(0, 260)
      });
      if (!isSearchResultPage()) {
        logger.warn("搜索提交后仍停留在建议页，尝试点击第一条搜索建议", {
          keyword: keyword,
          textSample: extractVisibleText().slice(0, 180)
        });
        if (clickFirstSearchSuggestion(keyword)) {
          autojsUtils.sleepRandom(1600, 2400);
        }
      }
      if (!isSearchResultPage()) {
        logger.warn("搜索提交后未确认进入搜索结果页", {
          keyword: keyword,
          textSample: extractVisibleText().slice(0, 220)
        });
        return false;
      }
      return true;
    }
    activeSearchKeyword = previousSearchKeyword;
    logger.warn("未找到搜索入口，保留在当前页面");
    return false;
  }

  function focusSearchInput(searchNode) {
    var bounds = searchNode && searchNode.bounds && searchNode.bounds();
    var visibleText = extractVisibleText();
    if (isTopSearchSubmitButton(bounds) && isSearchInputAlreadyVisible(visibleText)) {
      var screen = autojsUtils.getScreenSize(bounds);
      var x = Math.floor(screen.width * 0.38);
      var y = bounds.centerY();
      logger.info("搜索入口命中顶部提交按钮，改点左侧输入框", {
        bounds: autojsUtils.formatBounds(bounds),
        x: x,
        y: y,
        screen: autojsUtils.describeScreenSize(bounds)
      });
      return autojsUtils.clickPoint(x, y, logger, "search_input_focus");
    }
    return autojsUtils.safeClick(searchNode, 3, logger);
  }

  function isSearchInputAlreadyVisible(visibleText) {
    var lines = normalizeVisibleLines(visibleText);
    return (
      hasLineInFirst(lines, "搜索", 8) ||
      hasSearchTabCluster(visibleText) ||
      /相关搜索|筛选|最近看过/.test(visibleText || "") ||
      !!(activeSearchKeyword && visibleText && visibleText.indexOf(activeSearchKeyword) >= 0)
    );
  }

  function submitSearchKeyword(keyword) {
    logger.info("搜索提交诊断：开始查找提交按钮", {
      keyword: keyword,
      screen: autojsUtils.describeScreenSize()
    });
    var searchButton =
      autojsUtils.waitForElement(text("搜索"), 1200, null, logger) ||
      autojsUtils.waitForElement(desc("搜索"), 700, null, logger);
    if (searchButton) {
      var bounds = searchButton.bounds && searchButton.bounds();
      logger.info("搜索提交诊断：候选搜索按钮", {
        keyword: keyword,
        text: searchButton.text && searchButton.text(),
        desc: searchButton.desc && searchButton.desc(),
        bounds: autojsUtils.formatBounds(bounds),
        isTopSubmit: isTopSearchSubmitButton(bounds),
        screen: autojsUtils.describeScreenSize(bounds)
      });
      if (isTopSearchSubmitButton(bounds)) {
        logger.info("点击顶部搜索按钮提交关键词", {
          keyword: keyword,
          bounds: autojsUtils.formatBounds(bounds),
          screen: autojsUtils.getScreenSize(bounds)
        });
        if (autojsUtils.axisClick(searchButton, logger)) {
          autojsUtils.sleepRandom(1200, 2000);
          return true;
        }
        logger.warn("顶部搜索按钮坐标点击失败，改用搜索建议提交", { keyword: keyword });
      } else {
        logger.info("搜索按钮疑似输入框标题或建议文本，改用搜索建议提交", {
          keyword: keyword,
          bounds: bounds ? "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]" : ""
        });
      }
    } else {
      logger.warn("未找到顶部搜索按钮，改用搜索建议提交", { keyword: keyword });
    }

    clickFirstSearchSuggestion(keyword);
    autojsUtils.sleepRandom(1200, 2000);
    return true;
  }

  function isTopSearchSubmitButton(bounds) {
    if (!bounds) {
      return false;
    }
    var screen = autojsUtils.getScreenSize(bounds);
    var centerX = bounds.centerX();
    var centerY = bounds.centerY();
    var topLimit = Math.max(220, screen.height * 0.18);
    return bounds.top >= 0 && centerY <= topLimit && centerX >= screen.width * 0.62;
  }

  function pushFoundNodes(target, selector) {
    try {
      var collection = selector.find();
      var count = typeof collection.length === "number" ? collection.length : (collection.size ? collection.size() : 0);
      for (var i = 0; i < count; i++) {
        var node = typeof collection.get === "function" ? collection.get(i) : collection[i];
        if (node) {
          target.push(node);
        }
      }
    } catch (error) {
    }
  }

  function clickFirstSearchSuggestion(keyword) {
    var nodes = [];
    if (keyword) {
      pushFoundNodes(nodes, text(keyword));
      pushFoundNodes(nodes, textContains(keyword));
      pushFoundNodes(nodes, textContains(keyword.slice(0, Math.min(4, keyword.length))));
    }
    pushFoundNodes(nodes, textMatches(/.+/));

    var best = null;
    var bestScore = -1;
    var bestY = 999999;
    var screen = autojsUtils.getScreenSize();
    var candidateSamples = [];
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      var value = node.text && node.text();
      var bounds = node.bounds && node.bounds();
      if (value && bounds && candidateSamples.length < 8) {
        candidateSamples.push({
          text: value,
          bounds: autojsUtils.formatBounds(bounds),
          clickable: !!(node.clickable && node.clickable())
        });
      }
      if (!value || !bounds) {
        continue;
      }
      if (bounds.centerY() < screen.height * 0.12 || bounds.centerY() > screen.height * 0.72) {
        continue;
      }
      if (value === "搜索" || value === "反馈" || value.length < 2) {
        continue;
      }
      if (keyword && value.indexOf(keyword.slice(0, Math.min(2, keyword.length))) < 0) {
        continue;
      }
      var score = 0;
      if (keyword && value === keyword) {
        score += 20;
      }
      if (keyword && value.indexOf(keyword) >= 0) {
        score += 10;
      }
      if (node.clickable && node.clickable()) {
        score += 3;
      }
      if (score > bestScore || (score === bestScore && bounds.centerY() < bestY)) {
        bestScore = score;
        bestY = bounds.centerY();
        best = node;
      }
    }

    if (best) {
      var bestBounds = best.bounds();
      logger.info("点击搜索建议进入结果页", {
        keyword: keyword,
        text: best.text && best.text(),
        bounds: autojsUtils.formatBounds(bestBounds),
        candidateCount: nodes.length,
        candidateSamples: candidateSamples,
        screen: autojsUtils.describeScreenSize(bestBounds)
      });
      return autojsUtils.safeClick(best, 4, logger);
    }

    logger.warn("未找到可点击的搜索建议控件，尝试多点坐标兜底", {
      keyword: keyword,
      candidateCount: nodes.length,
      candidateSamples: candidateSamples,
      screen: autojsUtils.describeScreenSize(),
      textSample: extractVisibleText().slice(0, 180)
    });
    return clickSearchSuggestionFallback(keyword);
  }

  function clickSearchSuggestionFallback(keyword) {
    var screen = autojsUtils.getScreenSize();
    var headerBottom = Math.floor(Math.max(170, screen.height * 0.16));
    try {
      var searchNodes = text("搜索").find();
      var count = typeof searchNodes.length === "number" ? searchNodes.length : (searchNodes.size ? searchNodes.size() : 0);
      for (var i = 0; i < count; i++) {
        var node = typeof searchNodes.get === "function" ? searchNodes.get(i) : searchNodes[i];
        var bounds = node && node.bounds && node.bounds();
        if (isTopSearchSubmitButton(bounds)) {
          headerBottom = Math.max(headerBottom, bounds.bottom);
        }
      }
    } catch (error) {
    }

    var points = [
      { x: screen.width * 0.52, y: headerBottom + 55 },
      { x: screen.width * 0.52, y: headerBottom + 105 },
      { x: screen.width * 0.52, y: headerBottom + 155 }
    ];
    for (var j = 0; j < points.length; j++) {
      var x = Math.floor(points[j].x);
      var y = Math.floor(Math.min(points[j].y, screen.height * 0.72));
      logger.warn("搜索建议坐标兜底点击", { keyword: keyword, tryIndex: j + 1, x: x, y: y });
      autojsUtils.clickPoint(x, y, logger, "search_suggestion_fallback_" + (j + 1));
      autojsUtils.sleepRandom(1000, 1600);
      if (isSearchResultPage()) {
        logger.info("搜索建议坐标兜底进入结果页成功", { keyword: keyword, tryIndex: j + 1 });
        return true;
      }
    }
    return false;
  }

  function openFirstVideoFromSearch() {
    logger.info("尝试从搜索结果进入第一个视频");
    avoidFloaty("open_first_search_video");
    autojsUtils.sleepRandom(500, 800);

    var videoTab =
      autojsUtils.waitForElement(text("视频"), 800, null, logger) ||
      autojsUtils.waitForElement(desc("视频"), 500, null, logger);
    if (videoTab) {
      autojsUtils.safeClick(videoTab, 3, logger);
      autojsUtils.sleepRandom(500, 800);
    }

    for (var i = 0; i < 3; i++) {
      var point = findSearchResultClickPoint();
      logger.info("点击搜索结果视频", { tryIndex: i + 1, point: point });
      autojsUtils.clickPoint(point.x, point.y, logger, "search_result_video_" + (i + 1));
      autojsUtils.sleepRandom(1200, 2000);
      if (isVideoPlaybackPage()) {
        logger.info("已进入搜索结果视频播放页", { tryIndex: i + 1 });
        return true;
      }
      logger.warn("点击后仍停留在搜索结果页，继续尝试", {
        tryIndex: i + 1,
        textSample: extractVisibleText().slice(0, 160)
      });
      autojsUtils.sleepRandom(500, 800);
    }
    logger.warn("多次点击搜索结果仍未进入视频播放页，继续后续流程但标记需要恢复");
    return false;
  }

  function isVideoPlaybackPage() {
    var visibleText = extractVisibleText();
    if (!visibleText) {
      return false;
    }
    if (isSearchResultPage() || isOverlayText(visibleText) || isPublishPageText(visibleText)) {
      return false;
    }
    return /首页|朋友|消息|我|关注|推荐|分享|评论|点赞|展开|抖音/.test(visibleText);
  }

  function findSearchResultClickPoint() {
    var screen = autojsUtils.getScreenSize();
    var width = screen.width;
    var height = screen.height;
    var minX = Math.max(24, width * 0.06);
    var maxX = Math.max(minX, width - 24);
    var minY = Math.max(80, height * 0.18);
    var maxY = Math.max(minY, height * 0.88);
    var candidates = [
      { x: width * 0.28, y: height * 0.42 },
      { x: width * 0.50, y: height * 0.42 },
      { x: width * 0.28, y: height * 0.55 },
      { x: width * 0.50, y: height * 0.55 }
    ];

    function normalizePoint(point) {
      var x = Number(point && point.x);
      var y = Number(point && point.y);
      if (!isFinite(x) || !isFinite(y) || x < minX || x > maxX || y < minY || y > maxY) {
        return null;
      }
      return {
        x: Math.floor(Math.max(minX, Math.min(x, maxX))),
        y: Math.floor(Math.max(minY, Math.min(y, maxY))),
        bounds: point.bounds
      };
    }

    var imageNodes = [];
    try {
      var nodes = classNameMatches(/ImageView|Image/).find();
      for (var i = 0; i < nodes.length; i++) {
        var bounds = nodes[i].bounds && nodes[i].bounds();
        if (
          bounds &&
          bounds.width() > width * 0.18 &&
          bounds.height() > height * 0.08 &&
          bounds.top > height * 0.18 &&
          bounds.bottom < height * 0.9 &&
          bounds.centerX() >= minX &&
          bounds.centerX() <= maxX &&
          bounds.centerY() >= minY &&
          bounds.centerY() <= maxY
        ) {
          imageNodes.push({
            x: bounds.centerX(),
            y: bounds.centerY(),
            bounds: "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]"
          });
        }
      }
    } catch (error) {
    }

    if (imageNodes.length > 0) {
      imageNodes.sort(function (a, b) {
        return a.y === b.y ? a.x - b.x : a.y - b.y;
      });
      var imagePoint = normalizePoint(imageNodes[0]);
      if (imagePoint) {
        logger.info("根据图片节点选择搜索结果", imagePoint);
        return imagePoint;
      }
    }

    var durationPoint = findSearchResultDurationPoint(normalizePoint, height);
    if (durationPoint) {
      logger.info("根据视频时长节点选择搜索结果", durationPoint);
      return durationPoint;
    }

    for (var j = 0; j < candidates.length; j++) {
      var fallbackPoint = normalizePoint(candidates[j]);
      if (fallbackPoint) {
        logger.warn("未找到有效搜索结果图片节点，使用坐标兜底", fallbackPoint);
        return fallbackPoint;
      }
    }

    var centerPoint = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    logger.warn("搜索结果点击点全部无效，使用屏幕中心兜底", centerPoint);
    return centerPoint;
  }

  function findSearchResultDurationPoint(normalizePoint, screenHeight) {
    var durationNodes = [];
    try {
      var nodes = textMatches(/^\d{1,2}:\d{2}$/).find();
      var count = typeof nodes.length === "number" ? nodes.length : (nodes.size ? nodes.size() : 0);
      for (var i = 0; i < count; i++) {
        var node = typeof nodes.get === "function" ? nodes.get(i) : nodes[i];
        var bounds = node && node.bounds && node.bounds();
        if (
          bounds &&
          bounds.centerY() > screenHeight * 0.16 &&
          bounds.centerY() < screenHeight * 0.88 &&
          bounds.width() > 12 &&
          bounds.height() > 8
        ) {
          durationNodes.push({
            x: bounds.centerX(),
            y: bounds.centerY(),
            text: node.text && node.text(),
            bounds: autojsUtils.formatBounds(bounds)
          });
        }
      }
    } catch (error) {
    }

    if (!durationNodes.length) {
      return null;
    }
    durationNodes.sort(function (a, b) {
      return a.y === b.y ? a.x - b.x : a.y - b.y;
    });
    logger.info("搜索结果时长节点候选", {
      count: durationNodes.length,
      samples: durationNodes.slice(0, 5)
    });
    return normalizePoint(durationNodes[0]);
  }

  function isSearchResultPage() {
    var visibleText = extractVisibleText();
    return detectSearchPageState(visibleText).isResult;
  }

  function detectSearchPageState(visibleText) {
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

  function normalizeVisibleLines(text) {
    return String(text || "")
      .split(/\n+/)
      .map(function (line) {
        return line.replace(/\s+/g, "").trim();
      })
      .filter(function (line) {
        return line.length > 0;
      });
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

  function hasLineInFirst(lines, word, maxLines) {
    var limit = Math.min(lines.length, maxLines || lines.length);
    for (var i = 0; i < limit; i++) {
      if (lines[i] === word) {
        return true;
      }
    }
    return false;
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

  function hasStandaloneLine(text, word) {
    var lines = String(text || "").split(/\n+/);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].replace(/\s+/g, "") === word) {
        return true;
      }
    }
    return false;
  }

  function enterVideoFeed() {
    logger.info("进入视频流");
    sleep(1500);
    return true;
  }

  function ensurePlayableFeed(reason) {
    var visibleText = extractVisibleText();
    if (isSearchResultPage()) {
      logger.warn("当前仍在搜索结果页，尝试进入视频播放页", {
        reason: reason || "",
        textSample: visibleText.slice(0, 160)
      });
      if (!openFirstVideoFromSearch()) {
        throw new Error("search result video entry failed");
      }
      return true;
    }
    if (isPublishPageText(visibleText) || isOverlayText(visibleText)) {
      logger.warn("当前不在视频播放上下文，恢复推荐流", {
        reason: reason || "",
        textSample: visibleText.slice(0, 160)
      });
      ensureFeedContext(reason || "ensure_playable_feed");
      return true;
    }
    return true;
  }

  function closeKnownOverlays(maxBackTimes) {
    var maxTimes = maxBackTimes || 4;
    for (var i = 0; i < maxTimes; i++) {
      var visibleText = extractVisibleText();
      if (!isOverlayText(visibleText)) {
        return true;
      }
      logger.warn("检测到评论、商品或个人页浮层，尝试返回推荐流", {
        backIndex: i + 1,
        textSample: visibleText.slice(0, 160)
      });
      back();
      autojsUtils.sleepRandom(900, 1400);
    }
    return true;
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
    return /选择音乐|分段拍|照片|相机|开直播|创作灵感|灵感跟拍|倒计时|闪光灯|翻转|发布作品/.test(text);
  }

  function ensureFeedContext(reason) {
    logger.info("恢复抖音推荐流上下文", { reason: reason || "" });
    if (shouldRecoverSearchContext(reason)) {
      return restartSearchContext(reason || "ensure_feed_context");
    }
    closeKnownOverlays(4);
    autojsUtils.sleepRandom(800, 1300);
    var visibleText = extractVisibleText();
    if (isOverlayText(visibleText) || isPublishPageText(visibleText)) {
      logger.warn("返回后仍疑似不在推荐流，重启抖音上下文", {
        textSample: visibleText.slice(0, 160)
      });
      restartToFeed();
      return true;
    }
    return true;
  }

  function enterLiveFeed(keyword) {
    logger.info("进入直播采集阶段：不使用搜索框，沿用推荐流刷取");
    ensureFeedContext("enter_live_phase");
    enterVideoFeed();
    openLiveTabIfVisible();
    return true;
  }

  function shouldRecoverSearchContext(reason) {
    if (config.task.mode !== "search" || !activeSearchKeyword) {
      return false;
    }
    return !/live|直播|enter_live/i.test(String(reason || ""));
  }

  function restartSearchContext(reason) {
    logger.warn("搜索模式恢复：重新进入关键词搜索视频流", {
      reason: reason || "",
      keyword: activeSearchKeyword
    });
    home();
    autojsUtils.sleepRandom(1000, 1600);
    openApp();
    if (!openSearch(activeSearchKeyword)) {
      throw new Error("search context recover failed");
    }
    if (!openFirstVideoFromSearch()) {
      throw new Error("search context recover video entry failed");
    }
    return true;
  }

  function openLiveTabIfVisible() {
    var liveTab = findTopLiveTab();
    if (!liveTab) {
      logger.warn("未找到顶部直播入口，继续沿当前推荐流扫描直播候选");
      return false;
    }

    var bounds = liveTab.bounds();
    logger.info("找到顶部直播入口，切换到直播流", {
      text: liveTab.text && liveTab.text(),
      desc: liveTab.desc && liveTab.desc(),
      bounds: "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]"
    });
    autojsUtils.safeClick(liveTab, 3, logger);
    autojsUtils.sleepRandom(2500, 4000);
    closeKnownOverlays(2);
    return true;
  }

  function findTopLiveTab() {
    var nodes = [];
    try {
      var textNodes = text("直播").find();
      for (var i = 0; i < textNodes.length; i++) {
        nodes.push(textNodes[i]);
      }
    } catch (error) {
    }
    try {
      var descNodes = desc("直播").find();
      for (var j = 0; j < descNodes.length; j++) {
        nodes.push(descNodes[j]);
      }
    } catch (error2) {
    }

    var best = null;
    var bestScore = -1;
    var screen = autojsUtils.getScreenSize();
    for (var k = 0; k < nodes.length; k++) {
      var node = nodes[k];
      var bounds = node.bounds && node.bounds();
      if (!bounds) {
        continue;
      }
      var centerY = bounds.centerY();
      var centerX = bounds.centerX();
      if (centerY > screen.height * 0.38 || centerY < screen.height * 0.02) {
        continue;
      }
      if (centerX < screen.width * 0.05 || centerX > screen.width * 0.95) {
        continue;
      }
      var score = 10;
      if (centerY < screen.height * 0.2) {
        score += 8;
      }
      if (node.clickable && node.clickable()) {
        score += 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    return best;
  }

  function openLiveRoomFromCurrentScreen() {
    var entryNode =
      autojsUtils.waitForElement(textMatches(/.*进入直播间.*/), 1000, null, logger) ||
      autojsUtils.waitForElement(descMatches(/.*进入直播间.*/), 800, null, logger) ||
      autojsUtils.waitForElement(textMatches(/.*直播中.*/), 800, null, logger) ||
      autojsUtils.waitForElement(descMatches(/.*直播中.*/), 800, null, logger) ||
      autojsUtils.waitForElement(textMatches(/.*热聊中.*/), 800, null, logger) ||
      autojsUtils.waitForElement(textMatches(/.*讲解中.*/), 800, null, logger);

    if (entryNode) {
      logger.info("找到直播入口控件，尝试点击进入直播间");
      autojsUtils.safeClick(entryNode, 3, logger);
      autojsUtils.sleepRandom(2500, 4000);
      if (isLiveRoomVisible()) {
        return true;
      }
      logger.warn("点击直播入口后未确认进入直播间，准备返回", {
        textSample: extractVisibleText().slice(0, 160)
      });
      back();
      autojsUtils.sleepRandom(700, 1100);
      return false;
    }

    if (tryLiveEntryFallback()) {
      return true;
    }

    logger.info("未找到明确直播入口控件，不进入当前候选");
    return false;
  }

  function tryLiveEntryFallback() {
    var visibleText = extractVisibleText();
    if (!/进入直播间|点击进入直播间|正在直播|直播中|主播|讲解中|热聊中/.test(visibleText)) {
      return false;
    }

    var screen = autojsUtils.getScreenSize();
    var points = [
      { x: screen.width * 0.50, y: screen.height * 0.42, name: "center_upper" },
      { x: screen.width * 0.50, y: screen.height * 0.55, name: "center_middle" },
      { x: screen.width * 0.70, y: screen.height * 0.42, name: "right_upper" },
      { x: screen.width * 0.70, y: screen.height * 0.55, name: "right_middle" }
    ];

    for (var i = 0; i < points.length; i++) {
      logger.warn("直播入口控件未找到，尝试坐标兜底点击", {
        point: points[i].name,
        x: Math.floor(points[i].x),
        y: Math.floor(points[i].y),
        textSample: visibleText.slice(0, 160)
      });
      autojsUtils.clickPoint(Math.floor(points[i].x), Math.floor(points[i].y), logger, "live_entry_fallback_" + points[i].name);
      autojsUtils.sleepRandom(2200, 3200);
      if (isLiveRoomVisible()) {
        logger.info("坐标兜底进入直播间成功", { point: points[i].name });
        return true;
      }
      back();
      autojsUtils.sleepRandom(700, 1100);
    }
    return false;
  }

  function isLiveRoomVisible() {
    var visibleText = extractVisibleText();
    return /说点什么|主播|在线|正在直播|直播中|小黄车|粉丝团|礼物|连麦/.test(visibleText) && !isOverlayText(visibleText) && !isPublishPageText(visibleText);
  }

  function exitLiveRoom() {
    logger.info("退出直播间");
    back();
    autojsUtils.sleepRandom(1200, 2000);
  }

  function extractVisibleText() {
    var texts = [];
    var nodes = className("android.widget.TextView").find();
    for (var i = 0; i < nodes.length; i++) {
      var value = nodes[i].text();
      if (value) {
        texts.push(value);
      }
    }
    return texts.join("\n");
  }

  function extractScreen() {
    var screen = autojsUtils.getScreenSize();
    var width = screen.width;
    var height = screen.height;
    var result = ocrEngine.captureRegions({
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
    });
    var visibleText = extractVisibleText();
    var combinedText = [result.text, visibleText].filter(Boolean).join("\n");
    return {
      image: result.image,
      ocrText: result.text,
      ocrRegions: result.regions,
      visibleText: visibleText,
      combinedText: combinedText
    };
  }

  function extractFastText() {
    var visibleText = extractVisibleText();
    return {
      image: null,
      ocrText: "",
      visibleText: visibleText,
      combinedText: visibleText
    };
  }

  function openComments() {
    logger.info("尝试打开评论面板");
    var commentNode = findCommentEntry();

    if (commentNode) {
      autojsUtils.safeClick(commentNode, 3, logger);
      autojsUtils.sleepRandom(1800, 2600);
      logger.info("已点击评论控件入口");
      return true;
    }

    var screen = autojsUtils.getScreenSize();
    var width = screen.width;
    var height = screen.height;
    var ratios = [0.52, 0.57, 0.62, 0.67];
    for (var i = 0; i < ratios.length; i++) {
      logger.warn("未找到评论控件，尝试右侧坐标兜底", { ratio: ratios[i] });
      autojsUtils.clickPoint(width - 70, Math.floor(height * ratios[i]), logger, "comment_entry_fallback_" + ratios[i]);
      autojsUtils.sleepRandom(1200, 1800);
      if (isCommentPanelVisible()) {
        logger.info("坐标兜底打开评论面板成功", { ratio: ratios[i] });
        return true;
      }
      back();
      autojsUtils.sleepRandom(500, 900);
    }

    logger.warn("评论面板打开失败");
    return false;
  }

  function findCommentEntry() {
    var nodes = [];
    try {
      var descNodes = descMatches(/.*评论.*/).find();
      for (var i = 0; i < descNodes.length; i++) {
        nodes.push(descNodes[i]);
      }
    } catch (error) {
    }
    try {
      var textNodes = textMatches(/.*评论.*/).find();
      for (var j = 0; j < textNodes.length; j++) {
        nodes.push(textNodes[j]);
      }
    } catch (error2) {
    }

    var best = null;
    var bestScore = -1;
    var screen = autojsUtils.getScreenSize();
    for (var k = 0; k < nodes.length; k++) {
      var node = nodes[k];
      var bounds = node.bounds && node.bounds();
      if (!bounds) {
        continue;
      }
      var score = 0;
      if (bounds.centerX() > screen.width * 0.55) {
        score += 10;
      }
      if (bounds.centerY() > screen.height * 0.25 && bounds.centerY() < screen.height * 0.85) {
        score += 5;
      }
      if (node.clickable && node.clickable()) {
        score += 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }

    if (best) {
      var bestBounds = best.bounds();
      logger.info("找到评论入口控件", {
        text: best.text && best.text(),
        desc: best.desc && best.desc(),
        bounds: "[" + bestBounds.left + "," + bestBounds.top + "][" + bestBounds.right + "," + bestBounds.bottom + "]"
      });
    }

    return best;
  }

  function isCommentPanelVisible() {
    return !!(
      textMatches(/.*评论.*/).findOne(500) ||
      descMatches(/.*评论.*/).findOne(500) ||
      textMatches(/说点什么|抢首评|全部评论|暂无评论/).findOne(500)
    );
  }

  function extractHotComments(limit) {
    var comments = [];
    var nodes = className("android.widget.TextView").find();
    for (var i = 0; i < nodes.length && comments.length < limit; i++) {
      var value = nodes[i].text();
      if (
        value &&
        value.length >= 2 &&
        value.length <= 120 &&
        !/^\d+\s*评论$/.test(value) &&
        !/^0\s*评论$/.test(value) &&
        !/说点什么|抢首评|暂无评论/.test(value)
      ) {
        comments.push(value);
      }
    }
    logger.info("评论面板文本提取完成", { count: comments.length, comments: comments.slice(0, 5) });
    return comments;
  }

  function closeComments() {
    back();
    autojsUtils.sleepRandom(800, 1200);
  }

  function nextVideo() {
    var screen = autojsUtils.getScreenSize();
    var width = screen.width;
    var height = screen.height;
    logger.info("滑动到下一个视频", {
      fromX: Math.floor(width * 0.5),
      fromY: Math.floor(height * 0.78),
      toX: Math.floor(width * 0.5),
      toY: Math.floor(height * 0.22),
      durationMs: config.runtime.swipeDurationMs,
      screen: autojsUtils.describeScreenSize()
    });
    swipe(
      Math.floor(width * 0.5),
      Math.floor(height * 0.78),
      Math.floor(width * 0.5),
      Math.floor(height * 0.22),
      config.runtime.swipeDurationMs
    );
    autojsUtils.sleepRandom(1200, 2000);
  }

  function recover(sceneType) {
    logger.warn("执行抖音页面恢复");
    if (sceneType !== "live" && shouldRecoverSearchContext(sceneType || "recover")) {
      restartSearchContext("recover");
      return;
    }
    closeKnownOverlays(3);
    enterVideoFeed();
  }

  function restartToFeed() {
    logger.warn("重启任务上下文：回到手机首页并重新打开抖音");
    home();
    autojsUtils.sleepRandom(1200, 2000);
    openApp();
    enterVideoFeed();
  }

  return {
    openApp: openApp,
    openSearch: openSearch,
    openFirstVideoFromSearch: openFirstVideoFromSearch,
    enterVideoFeed: enterVideoFeed,
    ensurePlayableFeed: ensurePlayableFeed,
    enterLiveFeed: enterLiveFeed,
    ensureFeedContext: ensureFeedContext,
    openLiveRoomFromCurrentScreen: openLiveRoomFromCurrentScreen,
    isLiveRoomVisible: isLiveRoomVisible,
    exitLiveRoom: exitLiveRoom,
    extractFastText: extractFastText,
    extractScreen: extractScreen,
    openComments: openComments,
    extractHotComments: extractHotComments,
    closeComments: closeComments,
    nextVideo: nextVideo,
    recover: recover,
    restartSearchContext: restartSearchContext,
    restartToFeed: restartToFeed
  };
}

module.exports = {
  createDouyinAdapter: createDouyinAdapter
};
