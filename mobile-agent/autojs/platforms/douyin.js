function createDouyinAdapter(config, logger, ocrEngine, floatyControl, injectedScreenRecognizer, injectedLiveTargetMatcher) {
  var autojsUtils = require(files.join(config.runtime.scriptDir, "utils/autojs-utils.js"));
  var liveCardGeometry = require(files.join(config.runtime.scriptDir, "platforms/live-card-geometry.js"));
  var createScreenRecognizer = require(files.join(config.runtime.scriptDir, "core/screen-recognizer.js")).createScreenRecognizer;
  var liveTargetMatcher = injectedLiveTargetMatcher || require(files.join(config.runtime.scriptDir, "domain/live-target-matcher.js"));
  var packageName = "com.ss.android.ugc.aweme";
  var activeSearchKeyword = "";
  var lastSearchFailureReason = "";
  var pendingTargetLiveEntry = null;
  var lastTargetLiveSearchResult = null;
  var screenRecognizer = injectedScreenRecognizer || createScreenRecognizer(config, logger, ocrEngine, { expectedPackage: packageName });

  function recognitionOptions() {
    return {
      activeSearchKeyword: activeSearchKeyword
    };
  }

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
    autojsUtils.clickIfExists(text("以后再说").clickable(true), 800, logger);
    autojsUtils.clickIfExists(text("暂不").clickable(true), 800, logger);
    autojsUtils.clickIfExists(text("取消").clickable(true), 800, logger);
    autojsUtils.clickIfExists(textMatches(".*(允许).*").clickable(true), 800, logger);

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
          autojsUtils.clickIfExists(textMatches("^(允许|始终允许)$").clickable(true), 800, logger) ||
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

  function isForeground() {
    try {
      return currentPackage() === packageName;
    } catch (error) {
      logger.warn("current package check failed", { message: String(error) });
      return false;
    }
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
    lastSearchFailureReason = "";
    if (!ensureDouyinForeground()) {
      openApp();
      if (!ensureDouyinForeground()) {
        logger.warn("open search skipped: douyin not in foreground", {
          keyword: keyword,
          currentPackage: currentPackage && currentPackage()
        });
        return false;
      }
    }
    avoidFloaty("open_search");
    var previousSearchKeyword = activeSearchKeyword;
    var initialText = extractVisibleText();
    logger.info("搜索流程诊断：初始屏幕状态", {
      keyword: keyword,
      screen: autojsUtils.describeScreenSize(),
      textSample: initialText.slice(0, 180)
    });
    if (previousSearchKeyword === keyword && isSearchResultForKeyword(keyword, initialText)) {
      activeSearchKeyword = keyword || previousSearchKeyword;
      logger.info("搜索流程诊断：已在目标关键词搜索结果页，复用当前结果", {
        keyword: keyword,
        textSample: initialText.slice(0, 220)
      });
      return true;
    }

    var searchNode =
      autojsUtils.waitForElement(desc("搜索"), 1200, null, logger) ||
      autojsUtils.waitForElement(descContains("搜索"), 800, null, logger) ||
      autojsUtils.waitForElement(text("搜索"), 800, null, logger) ||
      autojsUtils.waitForElement(textContains("搜索"), 800, null, logger);

    if (searchNode) {
      focusSearchInput(searchNode);
      autojsUtils.sleepRandom(600, 1000);
      if (completeSearchKeyword(keyword, previousSearchKeyword, "node")) {
        return true;
      }
      logger.warn("搜索入口控件命中但关键词未完成输入，改用坐标兜底重试", {
        keyword: keyword,
        textSample: extractVisibleText().slice(0, 220),
        activity: safeCurrentActivity()
      });
      backFromSearchFallbackIfNeeded();
    }

    if (openSearchByCoordinateFallback(keyword, previousSearchKeyword)) {
      return true;
    }
    activeSearchKeyword = previousSearchKeyword;
    logger.warn("未找到搜索入口，保留在当前页面");
    return false;
  }

  function completeSearchKeyword(keyword, previousSearchKeyword, source) {
    if (!enterSearchKeyword(keyword, source)) {
      activeSearchKeyword = previousSearchKeyword;
      lastSearchFailureReason = "search_keyword_set_failed";
      return false;
    }
    if (!isSearchKeywordVisible(keyword)) {
      logger.warn("search keyword not visible after input", {
        keyword: keyword,
        source: source || "",
        inputText: getSearchInputText(),
        activity: safeCurrentActivity(),
        textSample: extractVisibleText().slice(0, 220)
      });
      activeSearchKeyword = previousSearchKeyword;
      lastSearchFailureReason = "search_keyword_set_failed";
      return false;
    }
    activeSearchKeyword = keyword || previousSearchKeyword;
    autojsUtils.sleepRandom(500, 800);
    logger.info("搜索流程诊断：关键词已输入", {
      keyword: keyword,
      source: source || "",
      screen: autojsUtils.describeScreenSize(),
      textSample: extractVisibleText().slice(0, 220)
    });

    submitSearchKeyword(keyword);
    dismissStartupPopups();
    var submittedText = extractVisibleText();
    var submittedState = detectSearchPageState(submittedText);
    logger.info("搜索流程诊断：提交后页面状态", {
      keyword: keyword,
      source: source || "",
      isSearchResultPage: submittedState.isResult,
      searchState: submittedState,
      screen: autojsUtils.describeScreenSize(),
      textSample: submittedText.slice(0, 260)
    });
    if (!isSearchResultPage()) {
      logger.warn("搜索提交后仍停留在建议页，尝试点击第一条搜索建议", {
        keyword: keyword,
        source: source || "",
        textSample: extractVisibleText().slice(0, 180)
      });
      if (clickFirstSearchSuggestion(keyword)) {
        autojsUtils.sleepRandom(1600, 2400);
      }
    }
    if (!isSearchResultPage()) {
      if (recoverSearchResultIssue(keyword, 0, "after_submit")) {
        autojsUtils.sleepRandom(900, 1400);
      }
    }
    if (!isSearchResultPage()) {
      logger.warn("搜索提交后未确认进入搜索结果页", {
        keyword: keyword,
        source: source || "",
        textSample: extractVisibleText().slice(0, 220)
      });
      activeSearchKeyword = previousSearchKeyword;
      lastSearchFailureReason = "target_search_open_failed";
      return false;
    }
    var finalText = extractVisibleText();
    if (!isSearchResultForKeyword(keyword, finalText)) {
      logger.warn("搜索提交后结果页关键词不匹配，停止复用旧结果", {
        keyword: keyword,
        source: source || "",
        textSample: finalText.slice(0, 260)
      });
      activeSearchKeyword = previousSearchKeyword;
      lastSearchFailureReason = "search_keyword_mismatch";
      return false;
    }
    return true;
  }

  function enterSearchKeyword(keyword, source) {
    var attempts = [
      inputSearchKeywordByNode,
      inputSearchKeywordGlobally,
      inputSearchKeywordByCoordinate,
      inputSearchKeywordByClipboard
    ];

    for (var i = 0; i < attempts.length; i++) {
      clearSearchKeywordIfPossible(keyword, source, i + 1);
      if (attempts[i](keyword, source, i + 1)) {
        autojsUtils.sleepRandom(300, 600);
        if (isSearchKeywordVisible(keyword)) {
          logger.info("搜索关键词输入成功", {
            keyword: keyword,
            source: source || "",
            strategyIndex: i + 1,
            inputText: getSearchInputText(),
            textSample: extractVisibleText().slice(0, 180)
          });
          return true;
        }
      }
      logger.warn("搜索关键词输入策略未生效", {
        keyword: keyword,
        source: source || "",
        strategyIndex: i + 1,
        inputText: getSearchInputText(),
        activity: safeCurrentActivity(),
        screen: autojsUtils.describeScreenSize(),
        textSample: extractVisibleText().slice(0, 180)
      });
    }

    return false;
  }

  function clearSearchKeywordIfPossible(keyword, source, attempt) {
    var clearNode =
      autojsUtils.waitForElement(desc("清空"), 250, null, null) ||
      autojsUtils.waitForElement(text("清空"), 250, null, null);
    if (!clearNode) {
      return false;
    }
    logger.info("清空搜索框旧内容", {
      keyword: keyword,
      source: source || "",
      attempt: attempt,
      bounds: autojsUtils.formatBounds(clearNode.bounds && clearNode.bounds())
    });
    autojsUtils.safeClick(clearNode, 3, logger);
    autojsUtils.sleepRandom(200, 400);
    return true;
  }

  function inputSearchKeywordByNode(keyword, source, attempt) {
    var inputNode = findSearchInputNode();
    if (!inputNode) {
      logger.warn("未找到搜索输入框控件", { keyword: keyword, source: source || "", attempt: attempt });
      return false;
    }
    try {
      autojsUtils.safeClick(inputNode, 3, logger);
      autojsUtils.sleepRandom(180, 320);
      if (inputNode.setText) {
        inputNode.setText(keyword);
        return true;
      }
    } catch (error) {
      logger.warn("搜索输入框控件 setText 失败", {
        keyword: keyword,
        source: source || "",
        attempt: attempt,
        message: String(error)
      });
    }
    return false;
  }

  function inputSearchKeywordGlobally(keyword, source, attempt) {
    try {
      setText(keyword);
      return true;
    } catch (error) {
      logger.warn("全局 setText 搜索关键词失败", {
        keyword: keyword,
        source: source || "",
        attempt: attempt,
        message: String(error)
      });
      return false;
    }
  }

  function inputSearchKeywordByCoordinate(keyword, source, attempt) {
    var point = findSearchInputFallbackPoint();
    logger.info("坐标点击搜索输入框后输入关键词", {
      keyword: keyword,
      source: source || "",
      attempt: attempt,
      point: point,
      screen: autojsUtils.describeScreenSize()
    });
    autojsUtils.clickPoint(point.x, point.y, logger, "search_input_fallback");
    autojsUtils.sleepRandom(250, 450);
    try {
      setText(keyword);
      return true;
    } catch (setTextError) {
      logger.warn("坐标聚焦后 setText 搜索关键词失败", {
        keyword: keyword,
        source: source || "",
        attempt: attempt,
        message: String(setTextError)
      });
    }
    try {
      if (typeof input === "function") {
        input(keyword);
        return true;
      }
    } catch (inputError) {
      logger.warn("坐标聚焦后 input 搜索关键词失败", {
        keyword: keyword,
        source: source || "",
        attempt: attempt,
        message: String(inputError)
      });
    }
    return false;
  }

  function inputSearchKeywordByClipboard(keyword, source, attempt) {
    var point = findSearchInputFallbackPoint();
    autojsUtils.clickPoint(point.x, point.y, logger, "search_input_clipboard_fallback");
    autojsUtils.sleepRandom(200, 350);
    try {
      if (typeof setClip === "function") {
        setClip(keyword);
        autojsUtils.sleepRandom(150, 250);
      }
      if (typeof paste === "function") {
        paste();
        return true;
      }
      if (typeof input === "function") {
        input(keyword);
        return true;
      }
    } catch (error) {
      logger.warn("剪贴板搜索关键词输入失败", {
        keyword: keyword,
        source: source || "",
        attempt: attempt,
        message: String(error)
      });
    }
    return false;
  }

  function findSearchInputFallbackPoint() {
    var inputNode = findSearchInputNode();
    var bounds = inputNode && inputNode.bounds && inputNode.bounds();
    if (bounds) {
      return {
        x: Math.floor(bounds.left + Math.min(bounds.width() * 0.35, 180)),
        y: Math.floor(bounds.centerY())
      };
    }
    var screen = autojsUtils.getScreenSize();
    return {
      x: Math.floor(screen.width * 0.36),
      y: Math.floor(Math.max(72, screen.height * 0.075))
    };
  }

  function openSearchByCoordinateFallback(keyword, previousSearchKeyword) {
    logger.warn("搜索入口控件未找到，启用坐标兜底", {
      keyword: keyword,
      activity: safeCurrentActivity(),
      textSample: extractVisibleText().slice(0, 160),
      screen: autojsUtils.describeScreenSize()
    });
    leaveLiveRoomBeforeSearchIfNeeded();

    var screen = autojsUtils.getScreenSize();
    var points = [
      { x: screen.width * 0.92, y: screen.height * 0.075, name: "top_right_primary" },
      { x: screen.width * 0.86, y: screen.height * 0.075, name: "top_right_secondary" },
      { x: screen.width * 0.92, y: screen.height * 0.115, name: "top_right_lower" },
      { x: screen.width * 0.50, y: screen.height * 0.075, name: "top_center" }
    ];
    for (var i = 0; i < points.length; i++) {
      var x = Math.floor(points[i].x);
      var y = Math.floor(points[i].y);
      logger.warn("搜索入口坐标兜底点击", {
        keyword: keyword,
        point: points[i].name,
        x: x,
        y: y,
        activity: safeCurrentActivity()
      });
      autojsUtils.clickPoint(x, y, logger, "search_entry_fallback_" + points[i].name);
      autojsUtils.sleepRandom(1200, 1800);
      if (completeSearchKeyword(keyword, previousSearchKeyword, "coordinate:" + points[i].name)) {
        logger.info("搜索入口坐标兜底成功", { keyword: keyword, point: points[i].name });
        return true;
      }
      backFromSearchFallbackIfNeeded();
      if (!ensureDouyinForeground()) {
        openApp();
      }
    }
    return false;
  }

  function backFromSearchFallbackIfNeeded() {
    var visibleText = extractVisibleText();
    if (/搜索|猜你想搜|相关搜索|最近看过/.test(visibleText || "")) {
      back();
      autojsUtils.sleepRandom(500, 900);
    }
  }

  function leaveLiveRoomBeforeSearchIfNeeded() {
    var activity = safeCurrentActivity();
    var visibleText = extractVisibleText();
    if (/Live/i.test(activity) || isLiveRoomVisible() || /欢迎来到直播间|说点什么|直播间/.test(visibleText)) {
      logger.warn("搜索前检测到直播页，先返回普通视频流", {
        activity: activity,
        textSample: visibleText.slice(0, 160)
      });
      back();
      autojsUtils.sleepRandom(1000, 1600);
    }
  }

  function safeCurrentActivity() {
    try {
      return String(currentActivity && currentActivity() || "");
    } catch (error) {
      return "";
    }
  }

  function focusSearchInput(searchNode) {
    var bounds = searchNode && searchNode.bounds && searchNode.bounds();
    var visibleText = extractVisibleText();
    if (isTopSearchSubmitButton(bounds) && isSearchInputAlreadyVisible(visibleText)) {
      var inputNode = findSearchInputNode();
      if (inputNode) {
        logger.info("搜索入口命中顶部提交按钮，改点真实输入框", {
          bounds: autojsUtils.formatBounds(bounds),
          inputBounds: autojsUtils.formatBounds(inputNode.bounds && inputNode.bounds()),
          screen: autojsUtils.describeScreenSize(bounds)
        });
        return autojsUtils.safeClick(inputNode, 3, logger);
      }
    }
    return autojsUtils.safeClick(searchNode, 3, logger);
  }

  function isSearchInputAlreadyVisible(visibleText) {
    var lines = screenRecognizer.normalizeVisibleLines(visibleText);
    return (
      !!findSearchInputNode() ||
      screenRecognizer.hasLineInFirst(lines, "搜索", 8) ||
      /相关搜索|筛选|最近看过/.test(visibleText || "") ||
      !!(activeSearchKeyword && visibleText && visibleText.indexOf(activeSearchKeyword) >= 0)
    );
  }

  function findSearchInputNode() {
    var selectors = [
      className("android.widget.EditText"),
      idContains("et_search"),
      idContains("search_kw"),
      idContains("search_edit"),
      descContains("搜索框")
    ];
    for (var i = 0; i < selectors.length; i++) {
      var node = null;
      try {
        node = selectors[i].findOne(300);
      } catch (error) {
        node = null;
      }
      if (!node || !node.bounds) {
        continue;
      }
      var bounds = node.bounds();
      var screen = autojsUtils.getScreenSize(bounds);
      var maxInputBottom = Math.max(220, Math.floor(screen.height * 0.18));
      if (bounds && bounds.bottom > 0 && bounds.bottom <= maxInputBottom && bounds.width() > screen.width * 0.28) {
        return node;
      }
    }
    return null;
  }

  function readNodeTextValue(node) {
    if (!node) {
      return "";
    }
    try {
      if (node.text) {
        var textValue = node.text();
        if (textValue) {
          return String(textValue);
        }
      }
    } catch (error) {
    }
    try {
      if (node.desc) {
        var descValue = node.desc();
        if (descValue) {
          return String(descValue);
        }
      }
    } catch (error2) {
    }
    return "";
  }

  function getSearchInputText() {
    var inputNode = findSearchInputNode();
    return readNodeTextValue(inputNode);
  }

  function isSearchKeywordVisible(keyword) {
    keyword = String(keyword || "").trim();
    if (!keyword) {
      return false;
    }
    var inputText = getSearchInputText();
    if (inputText && inputText.indexOf(keyword) >= 0) {
      return true;
    }
    var visibleText = extractVisibleText();
    return !!(visibleText && visibleText.indexOf(keyword) >= 0);
  }

  function isSearchResultForKeyword(keyword, visibleText) {
    keyword = String(keyword || "").trim();
    visibleText = String(visibleText || "");
    if (!keyword || !visibleText) {
      return false;
    }
    var searchState = detectSearchPageState(visibleText);
    return !!(searchState.isResult && visibleText.indexOf(keyword) >= 0);
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
    pushFoundNodes(nodes, textMatches(".+"));

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
    return screenRecognizer.isVideoPlaybackPage(recognitionOptions());
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
      var nodes = textMatches("^\\d{1,2}:\\d{2}$").find();
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

  function isSearchResultPage(visibleText) {
    return screenRecognizer.isSearchResultPage(visibleText, recognitionOptions());
  }

  function detectSearchPageState(visibleText) {
    return screenRecognizer.detectSearchPageState(visibleText, recognitionOptions());
  }

  function normalizeVisibleLines(text) {
    return screenRecognizer.normalizeVisibleLines(text);
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
    return screenRecognizer.hasLineInFirst(lines, word, maxLines);
  }

  function hasSearchTabCluster(text) {
    return screenRecognizer.hasSearchTabCluster(text);
  }

  function hasStandaloneLine(text, word) {
    return screenRecognizer.hasStandaloneLine(text, word);
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
    return screenRecognizer.isOverlayText(text);
  }

  function isPublishPageText(text) {
    return screenRecognizer.isPublishPageText(text);
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

  function openLiveSearch(keyword) {
    keyword = String(keyword || "").replace(/\s+/g, " ").trim();
    if (!keyword) {
      return false;
    }
    if (!openSearch(keyword)) {
      return false;
    }
    autojsUtils.sleepRandom(1000, 1600);
    recoverSearchResultIssue(keyword, 0, "open_live_search");
    logger.info("指定直播间测试：保留在综合搜索结果页，直接从综合页寻找直播入口", {
      keyword: keyword,
      textSample: extractVisibleText().slice(0, 180)
    });
    return true;
  }

  function escapeRegexText(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildContainsRegex(values) {
    values = values || [];
    var parts = [];
    for (var i = 0; i < values.length; i++) {
      var value = String(values[i] || "").replace(/\s+/g, " ").trim();
      if (value) {
        parts.push(escapeRegexText(value));
      }
    }
    return parts.length ? new RegExp(".*(" + parts.join("|") + ").*") : null;
  }

  function hasAnyTextKeyword(textValue, keywords) {
    textValue = String(textValue || "");
    keywords = keywords || [];
    for (var i = 0; i < keywords.length; i++) {
      var keyword = String(keywords[i] || "").replace(/\s+/g, " ").trim();
      if (keyword && textValue.indexOf(keyword) >= 0) {
        return true;
      }
    }
    return false;
  }

  function matchesLiveTargetText(textValue, targetRoom) {
    if (!targetRoom || !targetRoom.targetName || !liveTargetMatcher || !liveTargetMatcher.findBestLiveTargetMatch) {
      return false;
    }
    var result = liveTargetMatcher.findBestLiveTargetMatch(textValue, [targetRoom]);
    if (result && result.matched) {
      logger.info("目标直播间相似度匹配命中", {
        targetName: targetRoom.targetName || "",
        targetCode: targetRoom.targetCode || "",
        similarity: result.similarity,
        threshold: result.threshold,
        matchedAlias: result.matchedAlias || "",
        textSample: String(textValue || "").slice(0, 180)
      });
      return true;
    }
    if (result && result.reason === "forbidden_keyword") {
      logger.warn("目标直播间命中排除关键词，跳过", {
        targetName: targetRoom.targetName || "",
        forbiddenKeyword: result.forbiddenKeyword || "",
        textSample: String(textValue || "").slice(0, 180)
      });
    }
    return false;
  }

  function hasTargetTextMatch(textValue, keywords, targetRoom) {
    return hasAnyTextKeyword(textValue, keywords) || matchesLiveTargetText(textValue, targetRoom);
  }

  function enterMall() {
    if (!ensureDouyinForeground()) {
      openApp();
    }
    closeKnownOverlays(2);
    var nodes = [];
    pushFoundNodes(nodes, text("商城"));
    pushFoundNodes(nodes, desc("商城"));
    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds) {
        continue;
      }
      var score = 0;
      if (bounds.centerY() > screen.height * 0.55) {
        score += 20;
      }
      if (bounds.centerY() < screen.height * 0.25) {
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
    if (!best) {
      logger.warn("未找到商城入口", {
        textSample: extractVisibleText().slice(0, 160)
      });
      return false;
    }
    logger.info("进入抖音商城", {
      bounds: autojsUtils.formatBounds(best.bounds && best.bounds())
    });
    autojsUtils.safeClick(best, 3, logger);
    autojsUtils.sleepRandom(1800, 2600);
    return true;
  }

  function clickCommerceResultTabIfVisible() {
    var tabNode =
      autojsUtils.waitForElement(textMatches("^(商品|店铺)$"), 600, null, null) ||
      autojsUtils.waitForElement(descMatches("^(商品|店铺)$"), 600, null, null);
    if (!tabNode) {
      return false;
    }
    logger.info("商城搜索结果切换商品相关标签", {
      text: tabNode.text && tabNode.text(),
      desc: tabNode.desc && tabNode.desc(),
      bounds: autojsUtils.formatBounds(tabNode.bounds && tabNode.bounds())
    });
    autojsUtils.safeClick(tabNode, 3, logger);
    autojsUtils.sleepRandom(1000, 1600);
    return true;
  }

  function openCommerceCardSearch(keyword) {
    keyword = String(keyword || "").replace(/\s+/g, " ").trim();
    if (!keyword) {
      return false;
    }
    if (!enterMall()) {
      return false;
    }
    if (!openSearch(keyword)) {
      logger.warn("商城商品卡搜索失败", {
        keyword: keyword,
        reason: lastSearchFailureReason || "",
        textSample: extractVisibleText().slice(0, 180)
      });
      return false;
    }
    clickCommerceResultTabIfVisible();
    logger.info("商城商品卡搜索完成", {
      keyword: keyword,
      textSample: extractVisibleText().slice(0, 180)
    });
    return true;
  }

  function isCommerceSearchOrDetailText(textValue) {
    var textValueString = String(textValue || "");
    if (/商品\s*评价\s*详情|客服|加购物车|立即购买|领券购买|去抢购/.test(textValueString)) {
      return true;
    }
    if (/搜索/.test(textValueString) && /综合|销量|筛选|回头客|产地直供|好评多|商品/.test(textValueString)) {
      return true;
    }
    return false;
  }

  function isCommerceVideoDriftText(textValue) {
    var textValueString = String(textValue || "");
    if (!/赞|评论|收藏|分享/.test(textValueString)) {
      return false;
    }
    return /视频同款|发弹幕|发布时间|音乐|未点赞|喜欢赞/.test(textValueString) &&
      !/商品\s*评价\s*详情|客服|加购物车|立即购买|领券购买/.test(textValueString);
  }

  function recoverCommerceCardSearch(searchKeyword, reason, textSample) {
    logger.warn("商品卡浏览上下文偏离，重新进入商城搜索", {
      reason: reason || "",
      searchKeyword: searchKeyword || "",
      textSample: String(textSample || "").slice(0, 180)
    });
    return openCommerceCardSearch(searchKeyword);
  }

  function findCommerceLiveEntryNode(liveSignals) {
    var signalRegex = buildContainsRegex(liveSignals);
    if (!signalRegex) {
      return null;
    }
    var nodes = [];
    pushFoundNodes(nodes, textMatches(signalRegex));
    pushFoundNodes(nodes, descMatches(signalRegex));
    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    var samples = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds || !isLiveEntryBoundsAllowed(bounds, screen)) {
        continue;
      }
      var value = String((node.text && node.text()) || (node.desc && node.desc()) || "");
      if (samples.length < 8) {
        samples.push({
          text: value.slice(0, 30),
          bounds: autojsUtils.formatBounds(bounds)
        });
      }
      var score = 0;
      if (/进入直播间|点击进入直播间/.test(value)) {
        score += 30;
      }
      if (/直播中|正在直播|讲解中|主播讲解/.test(value)) {
        score += 20;
      }
      if (node.clickable && node.clickable()) {
        score += 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    logger.info("商品卡直播入口候选筛选完成", {
      total: nodes.length,
      selected: !!best,
      bestScore: bestScore,
      samples: samples
    });
    return best;
  }

  function clickCommerceKeywordCard(matchKeywords) {
    var keywordRegex = buildContainsRegex(matchKeywords);
    if (!keywordRegex) {
      return false;
    }
    var nodes = [];
    pushFoundNodes(nodes, textMatches(keywordRegex));
    pushFoundNodes(nodes, descMatches(keywordRegex));
    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds || !isTargetSearchBoundsAllowed(bounds, screen)) {
        continue;
      }
      var score = 10;
      if (bounds.centerY() > screen.height * 0.18 && bounds.centerY() < screen.height * 0.82) {
        score += 8;
      }
      if (bounds.width && bounds.width() > screen.width * 0.18) {
        score += 3;
      }
      if (node.clickable && node.clickable()) {
        score += 3;
      }
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    if (!best) {
      return false;
    }
    logger.info("点击命中关键词的商品卡片区域", {
      bounds: autojsUtils.formatBounds(best.bounds && best.bounds()),
      text: best.text && best.text(),
      desc: best.desc && best.desc()
    });
    autojsUtils.axisClick(best, logger);
    autojsUtils.sleepRandom(1800, 2600);
    return true;
  }

  function openCommerceLiveFromCurrentScreen(matchKeywords, liveSignals, targetRoom) {
    var entryNode = findCommerceLiveEntryNode(liveSignals);
    if (entryNode) {
      autojsUtils.axisClick(entryNode, logger);
      autojsUtils.sleepRandom(2500, 4000);
      if (isLiveRoomVisible()) {
        return true;
      }
      logger.warn("点击商品卡直播入口后未进入直播间", {
        textSample: extractVisibleText().slice(0, 180)
      });
      back();
      autojsUtils.sleepRandom(700, 1100);
      return false;
    }
    if (openLiveRoomFromCurrentScreen(extractVisibleText())) {
      return true;
    }
    if (!clickCommerceKeywordCard(matchKeywords)) {
      return false;
    }
    var detailText = extractVisibleText();
    if (!hasTargetTextMatch(detailText, matchKeywords, targetRoom) || !hasAnyTextKeyword(detailText, liveSignals)) {
      logger.info("商品详情页未同时命中商品关键词和直播信号", {
        textSample: detailText.slice(0, 180)
      });
      back();
      autojsUtils.sleepRandom(700, 1100);
      return false;
    }
    entryNode = findCommerceLiveEntryNode(liveSignals);
    if (!entryNode) {
      back();
      autojsUtils.sleepRandom(700, 1100);
      return false;
    }
    autojsUtils.axisClick(entryNode, logger);
    autojsUtils.sleepRandom(2500, 4000);
    if (isLiveRoomVisible()) {
      return true;
    }
    back();
    autojsUtils.sleepRandom(700, 1100);
    return false;
  }

  function confirmCommerceLiveRoom(matchKeywords, targetRoom) {
    if (!isLiveRoomVisible()) {
      return false;
    }
    var visibleText = extractVisibleText();
    if (hasTargetTextMatch(visibleText, matchKeywords, targetRoom)) {
      return true;
    }
    logger.warn("商品卡直播进房后二次关键词校验失败", {
      matchKeywords: matchKeywords,
      textSample: visibleText.slice(0, 220)
    });
    return false;
  }

  function openMatchingCommerceLiveFromCards(options) {
    options = options || {};
    var startedAt = Date.now();
    var searchKeyword = String(options.searchKeyword || "").replace(/\s+/g, " ").trim();
    var matchKeywords = options.matchKeywords || [];
    var liveSignals = options.liveSignals || [];
    var targetRoom = options.targetRoom || {};
    var scanMinutes = Math.max(1, Number(options.scanMinutes || 15));
    if (!searchKeyword) {
      return {
        success: false,
        reason: "commerce_search_keyword_empty"
      };
    }
    function isInterrupted(source) {
      if (!options.shouldStop || !options.shouldStop()) {
        return false;
      }
      logger.warn("商品卡直播扫描被控制命令中断", {
        source: source || "",
        searchKeyword: searchKeyword
      });
      return true;
    }
    if (!openCommerceCardSearch(searchKeyword)) {
      return {
        success: false,
        reason: lastSearchFailureReason || "commerce_search_failed",
        elapsedMs: Date.now() - startedAt
      };
    }
    var endAt = Date.now() + scanMinutes * 60 * 1000;
    var attempt = 0;
    while (Date.now() < endAt) {
      attempt += 1;
      if (isInterrupted("commerce_scan_attempt_" + attempt)) {
        return {
          success: false,
          reason: "manual_pause",
          elapsedMs: Date.now() - startedAt,
          attempt: attempt
        };
      }
      var visibleText = extractVisibleText();
      var keywordMatched = hasTargetTextMatch(visibleText, matchKeywords, targetRoom);
      var liveMatched = hasAnyTextKeyword(visibleText, liveSignals);
      logger.info("商品卡直播扫描页面", {
        attempt: attempt,
        keywordMatched: keywordMatched,
        liveMatched: liveMatched,
        textSample: visibleText.slice(0, 180)
      });
      if (keywordMatched && liveMatched && openCommerceLiveFromCurrentScreen(matchKeywords, liveSignals, targetRoom)) {
        if (confirmCommerceLiveRoom(matchKeywords, targetRoom)) {
          return {
            success: true,
            reason: "commerce_live_entry_found",
            attempt: attempt,
            elapsedMs: Date.now() - startedAt,
            matchedKeywords: matchKeywords,
            textSample: visibleText.slice(0, 220)
          };
        }
        back();
        autojsUtils.sleepRandom(900, 1400);
      }
      if (isInterrupted("commerce_scan_before_swipe_" + attempt)) {
        return {
          success: false,
          reason: "manual_pause",
          elapsedMs: Date.now() - startedAt,
          attempt: attempt
        };
      }
      swipeSearchResultsUp();
    }
    return {
      success: false,
      reason: "commerce_live_not_found",
      elapsedMs: Date.now() - startedAt,
      attempts: attempt
    };
  }

  function browseCommerceCards(options) {
    options = options || {};
    var startedAt = Date.now();
    var searchKeyword = String(options.searchKeyword || "").replace(/\s+/g, " ").trim();
    var matchKeywords = options.matchKeywords || [];
    var liveSignals = options.liveSignals || [];
    var recommendationSignals = options.recommendationSignals || ["你可能还会喜欢"];
    var targetRoom = options.targetRoom || {};
    var scanMinutes = Math.max(1, Number(options.scanMinutes || 15));
    var cardCount = Math.max(1, Number(options.cardCount || 4));
    var dwellSeconds = Math.max(1, Number(options.dwellSeconds || 120));
    var liveWatchSeconds = Math.max(1, Math.min(dwellSeconds, Number(options.liveWatchSeconds || dwellSeconds)));
    if (!searchKeyword) {
      return {
        success: false,
        reason: "commerce_search_keyword_empty"
      };
    }
    function isInterrupted(source) {
      if (options.pollControlCommands) {
        options.pollControlCommands(false);
      }
      if (!options.shouldStop || !options.shouldStop()) {
        return false;
      }
      logger.warn("commerce card browsing interrupted by control command", {
        source: source || "",
        searchKeyword: searchKeyword
      });
      return true;
    }
    function sleepInterruptible(totalMs, source) {
      var endAt = Date.now() + Math.max(0, Number(totalMs || 0));
      while (Date.now() < endAt) {
        if (isInterrupted(source)) {
          return false;
        }
        var slice = Math.min(1000, Math.max(0, endAt - Date.now()));
        if (slice <= 0) {
          break;
        }
        if (typeof sleep === "function") {
          sleep(slice);
        } else {
          autojsUtils.sleepRandom(slice, slice);
        }
      }
      return true;
    }
    function browseOpenedCommerceDetail(attempt, hardEndAt, remainingCards) {
      var detailStartedAt = Date.now();
      var detailEndAt = Math.min(hardEndAt, detailStartedAt + dwellSeconds * 1000);
      var detailBrowsedCount = 1;
      var openedLive = false;
      var recommendedClicks = 0;
      var nextSwipeAt = detailStartedAt + 15000;
      var sample = "";
      while (Date.now() < detailEndAt && Date.now() < hardEndAt) {
        if (isInterrupted("commerce_detail_browse_" + attempt)) {
          return {
            success: false,
            reason: "manual_pause",
            browsedCount: detailBrowsedCount,
            textSample: sample
          };
        }
        var detailText = extractVisibleText();
        sample = detailText.slice(0, 220);
        if (!openedLive && hasAnyTextKeyword(detailText, liveSignals) && openCommerceLiveFromCurrentScreen(matchKeywords, liveSignals, targetRoom)) {
          openedLive = true;
          var liveWatchMs = Math.min(liveWatchSeconds * 1000, Math.max(0, detailEndAt - Date.now()));
          if (liveWatchMs > 0 && !sleepInterruptible(liveWatchMs, "commerce_detail_live_watch_" + attempt)) {
            return {
              success: false,
              reason: "manual_pause",
              browsedCount: detailBrowsedCount,
              textSample: sample
            };
          }
          if (isLiveRoomVisible()) {
            exitLiveRoom();
          } else {
            back();
            autojsUtils.sleepRandom(700, 1100);
          }
        }
        if (Date.now() >= nextSwipeAt && Date.now() + 1200 < detailEndAt) {
          swipeSearchResultsUp();
          nextSwipeAt = Date.now() + 15000;
          continue;
        }
        if (recommendedClicks < 2 &&
          detailBrowsedCount < remainingCards &&
          Date.now() - detailStartedAt >= Math.min(60000, Math.floor(dwellSeconds * 500)) &&
          Date.now() + dwellSeconds * 1000 < hardEndAt &&
          hasAnyTextKeyword(detailText, recommendationSignals) &&
          hasTargetTextMatch(detailText, matchKeywords, targetRoom) &&
          clickCommerceKeywordCard(matchKeywords)) {
          recommendedClicks += 1;
          detailBrowsedCount += 1;
          detailStartedAt = Date.now();
          detailEndAt = Math.min(hardEndAt, detailStartedAt + dwellSeconds * 1000);
          nextSwipeAt = detailStartedAt + 15000;
          openedLive = false;
          continue;
        }
        if (!sleepInterruptible(Math.min(1000, detailEndAt - Date.now()), "commerce_detail_wait_" + attempt)) {
          return {
            success: false,
            reason: "manual_pause",
            browsedCount: detailBrowsedCount,
            textSample: sample
          };
        }
      }
      return {
        success: true,
        browsedCount: detailBrowsedCount,
        textSample: sample
      };
    }
    if (!openCommerceCardSearch(searchKeyword)) {
      return {
        success: false,
        reason: lastSearchFailureReason || "commerce_search_failed",
        elapsedMs: Date.now() - startedAt
      };
    }
    var endAt = Date.now() + scanMinutes * 60 * 1000;
    var attempt = 0;
    var browsedCount = 0;
    var lastTextSample = "";
    while (Date.now() < endAt && browsedCount < cardCount) {
      attempt += 1;
      if (isInterrupted("commerce_browse_attempt_" + attempt)) {
        return {
          success: false,
          reason: "manual_pause",
          elapsedMs: Date.now() - startedAt,
          attempt: attempt,
          browsedCount: browsedCount
        };
      }
      var visibleText = extractVisibleText();
      lastTextSample = visibleText.slice(0, 220);
      if (isCommerceVideoDriftText(visibleText) || !isCommerceSearchOrDetailText(visibleText)) {
        if (isInterrupted("commerce_browse_context_check_" + attempt)) {
          return {
            success: false,
            reason: "manual_pause",
            elapsedMs: Date.now() - startedAt,
            attempt: attempt,
            browsedCount: browsedCount
          };
        }
        if (!recoverCommerceCardSearch(searchKeyword, "commerce_context_drift", visibleText)) {
          return {
            success: false,
            reason: lastSearchFailureReason || "commerce_context_recover_failed",
            elapsedMs: Date.now() - startedAt,
            attempt: attempt,
            browsedCount: browsedCount,
            textSample: lastTextSample
          };
        }
        visibleText = extractVisibleText();
        lastTextSample = visibleText.slice(0, 220);
      }
      var keywordMatched = hasTargetTextMatch(visibleText, matchKeywords, targetRoom);
      logger.info("commerce card browsing page", {
        attempt: attempt,
        browsedCount: browsedCount,
        targetCount: cardCount,
        keywordMatched: keywordMatched,
        textSample: visibleText.slice(0, 180)
      });
      if (keywordMatched && clickCommerceKeywordCard(matchKeywords)) {
        var detailResult = browseOpenedCommerceDetail(attempt, endAt, cardCount - browsedCount);
        browsedCount += Math.max(1, Number(detailResult.browsedCount || 1));
        lastTextSample = detailResult.textSample || lastTextSample;
        logger.info("commerce card detail browsed", {
          attempt: attempt,
          browsedCount: browsedCount,
          targetCount: cardCount,
          textSample: String(lastTextSample || "").slice(0, 180)
        });
        if (!detailResult.success) {
          return {
            success: false,
            reason: detailResult.reason || "manual_pause",
            elapsedMs: Date.now() - startedAt,
            attempt: attempt,
            browsedCount: browsedCount,
            textSample: lastTextSample
          };
        }
        back();
        autojsUtils.sleepRandom(700, 1100);
      }
      if (isInterrupted("commerce_browse_before_swipe_" + attempt)) {
        return {
          success: false,
          reason: "manual_pause",
          elapsedMs: Date.now() - startedAt,
          attempt: attempt,
          browsedCount: browsedCount
        };
      }
      if (browsedCount < cardCount) {
        swipeSearchResultsUp();
      }
    }
    return {
      success: browsedCount > 0,
      reason: browsedCount > 0 ? "commerce_cards_browsed" : "commerce_card_not_found",
      elapsedMs: Date.now() - startedAt,
      attempts: attempt,
      browsedCount: browsedCount,
      matchedKeywords: matchKeywords,
      textSample: lastTextSample
    };
  }

  function setTargetLiveSearchResult(reason, extra) {
    lastTargetLiveSearchResult = {
      reason: reason || "",
      at: new Date().toISOString()
    };
    extra = extra || {};
    for (var key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        lastTargetLiveSearchResult[key] = extra[key];
      }
    }
    return lastTargetLiveSearchResult;
  }

  function getLastTargetLiveSearchResult() {
    return lastTargetLiveSearchResult || {};
  }

  function targetRoomRuntimeKey(targetRoom) {
    var code = String(targetRoom && targetRoom.targetCode || "").replace(/\s+/g, " ").trim().toLowerCase();
    return code ? "target:" + code : "";
  }

  function restartToLiveFeed(reason) {
    logger.warn("重启任务上下文：回到手机首页并重新进入抖音直播流", {
      reason: reason || ""
    });
    home();
    autojsUtils.sleepRandom(1200, 2000);
    openApp();
    closeKnownOverlays(3);
    enterVideoFeed();
    openLiveTabIfVisible();
    return true;
  }

  function findBottomHomeTab() {
    var nodes = [];
    pushFoundNodes(nodes, text("首页"));
    pushFoundNodes(nodes, desc("首页"));
    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds) {
        continue;
      }
      var centerY = bounds.centerY();
      var centerX = bounds.centerX();
      if (centerY < screen.height * 0.58 || centerY > screen.height * 0.98) {
        continue;
      }
      if (centerX < screen.width * 0.02 || centerX > screen.width * 0.45) {
        continue;
      }
      var score = 10;
      if (centerX < screen.width * 0.25) {
        score += 8;
      }
      if (centerY > screen.height * 0.78) {
        score += 6;
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

  function clickBottomHomeTab() {
    var homeNode = findBottomHomeTab();
    if (homeNode) {
      logger.info("点击抖音底部首页刷新直播流", {
        bounds: autojsUtils.formatBounds(homeNode.bounds && homeNode.bounds())
      });
      autojsUtils.safeClick(homeNode, 3, logger);
      autojsUtils.sleepRandom(1400, 2200);
      return true;
    }
    var screen = autojsUtils.getScreenSize();
    var x = Math.floor(screen.width * 0.14);
    var y = Math.floor(screen.height * 0.92);
    logger.warn("未找到底部首页控件，使用坐标兜底刷新直播流", { x: x, y: y });
    autojsUtils.clickPoint(x, y, logger, "bottom_home_fallback");
    autojsUtils.sleepRandom(1400, 2200);
    return true;
  }

  function refreshLiveFeedFromHome(options) {
    options = options || {};
    logger.info("刷新直播流：回到底部首页后重新进入直播板块", {
      reason: options.reason || ""
    });
    if (!isForeground()) {
      openApp();
    }
    closeKnownOverlays(3);
    if (isLiveRoomVisible()) {
      exitLiveRoom();
    }
    clickBottomHomeTab();
    enterVideoFeed();
    openLiveTabIfVisible();
    closeKnownOverlays(2);
    return true;
  }

  function openTargetLiveRoomFromLiveFeed(options) {
    options = options || {};
    var startedAt = Date.now();
    var targetRoom = options.targetRoom || {};
    var keyword = String(options.keyword || pickTargetRoomSearchKeyword(targetRoom) || "").replace(/\s+/g, " ").trim();
    var targetKeywords = buildTargetRoomKeywords(targetRoom, keyword);
    var maxCandidates = Math.max(1, Number(options.maxCandidates || options.maxRooms || 25));
    var source = options.source || "live_feed_gate";
    function isInterrupted(sourceName) {
      if (options.pollControlCommands) {
        options.pollControlCommands(false);
      }
      if (!options.shouldStop || !options.shouldStop()) {
        return false;
      }
      setTargetLiveSearchResult("manual_pause", {
        keyword: keyword,
        targetKeywords: targetKeywords,
        elapsedMs: Date.now() - startedAt,
        source: sourceName || source
      });
      return true;
    }
    if (!keyword && targetKeywords.length > 0) {
      keyword = targetKeywords[0];
    }
    if (!targetKeywords.length) {
      setTargetLiveSearchResult("target_keyword_empty", {
        keyword: keyword,
        targetKeywords: targetKeywords,
        source: source
      });
      return false;
    }
    setTargetLiveSearchResult("live_feed_gate_started", {
      keyword: keyword,
      targetKeywords: targetKeywords,
      source: source,
      maxCandidates: maxCandidates
    });
    if (options.restartBeforeScan) {
      restartToLiveFeed(source);
    } else if (options.enterLiveFeed !== false) {
      enterLiveFeed(keyword);
    }
    for (var candidateIndex = 1; candidateIndex <= maxCandidates; candidateIndex++) {
      if (isInterrupted("live_feed_candidate_" + candidateIndex)) {
        return false;
      }
      if (isLiveRoomVisible()) {
        if (confirmTargetLiveRoom(keyword, targetKeywords, candidateIndex, "target_live_feed_current_room", targetRoom)) {
          setTargetLiveSearchResult("room_verified", {
            keyword: keyword,
            targetKeywords: targetKeywords,
            matchedKeywords: targetKeywords,
            attempt: candidateIndex,
            candidatesChecked: candidateIndex,
            elapsedMs: Date.now() - startedAt,
            source: source,
            roomKey: targetRoomRuntimeKey(targetRoom),
            roomName: targetRoom.targetName || "",
            textSample: extractVisibleText().slice(0, 220)
          });
          return true;
        }
        if (isLiveRoomVisible()) {
          exitLiveRoom();
        }
      }
      var visibleText = extractVisibleText();
      if (hasTargetTextMatch(visibleText, targetKeywords, targetRoom)) {
        rememberPendingTargetLiveEntry(keyword, targetKeywords, {
          text: visibleText,
          contextText: visibleText
        }, "target_live_feed_candidate");
        if (openLiveRoomFromCurrentScreen(visibleText) && confirmTargetLiveRoom(keyword, targetKeywords, candidateIndex, "target_live_feed_candidate", targetRoom)) {
          setTargetLiveSearchResult("room_verified", {
            keyword: keyword,
            targetKeywords: targetKeywords,
            matchedKeywords: targetKeywords,
            attempt: candidateIndex,
            candidatesChecked: candidateIndex,
            elapsedMs: Date.now() - startedAt,
            source: source,
            roomKey: targetRoomRuntimeKey(targetRoom),
            roomName: targetRoom.targetName || "",
            textSample: visibleText.slice(0, 220)
          });
          return true;
        }
      } else {
        logger.info("直播流候选未命中目标直播间", {
          candidateIndex: candidateIndex,
          maxCandidates: maxCandidates,
          targetKeywords: targetKeywords,
          textSample: visibleText.slice(0, 180)
        });
      }
      if (candidateIndex < maxCandidates) {
        nextVideo();
      }
    }
    setTargetLiveSearchResult("target_live_room_not_found", {
      keyword: keyword,
      targetKeywords: targetKeywords,
      elapsedMs: Date.now() - startedAt,
      source: source,
      candidatesChecked: maxCandidates,
      textSample: extractVisibleText().slice(0, 220)
    });
    return false;
  }

  function openTargetLiveRoomFromSearch(options) {
    options = options || {};
    var startedAt = Date.now();
    var targetRoom = options.targetRoom || {};
    var keyword = String(options.keyword || pickTargetRoomSearchKeyword(targetRoom) || "").replace(/\s+/g, " ").trim();
    var targetKeywords = buildTargetRoomKeywords(targetRoom, keyword);
    if (!keyword && targetKeywords.length > 0) {
      keyword = targetKeywords[0];
    }
    if (!keyword) {
      logger.warn("target live search skipped: empty keyword");
      setTargetLiveSearchResult("target_keyword_empty", {
        keyword: "",
        targetKeywords: targetKeywords
      });
      return false;
    }
    function isInterrupted(source) {
      if (!options.shouldStop || !options.shouldStop()) {
        return false;
      }
      logger.warn("target live search interrupted by control command", {
        keyword: keyword,
        source: source || ""
      });
      setTargetLiveSearchResult("manual_pause", {
        keyword: keyword,
        targetKeywords: targetKeywords,
        elapsedMs: Date.now() - startedAt,
        source: source || "target_live_search"
      });
      return true;
    }

    setTargetLiveSearchResult("target_search_started", {
      keyword: keyword,
      targetKeywords: targetKeywords
    });

    if (isInterrupted("before_open_live_search")) {
      return false;
    }
    if (!openLiveSearch(keyword)) {
      setTargetLiveSearchResult(lastSearchFailureReason || "target_search_open_failed", {
        keyword: keyword,
        targetKeywords: targetKeywords
      });
      return false;
    }
    if (isInterrupted("after_open_live_search")) {
      return false;
    }

    ensureTargetLiveSearchComprehensiveTab(keyword, 0);

    for (var attempt = 1; attempt <= 4; attempt++) {
      if (isInterrupted("attempt_" + attempt + "_start")) {
        return false;
      }
      if (isLiveRoomVisible()) {
        if (confirmTargetLiveRoom(keyword, targetKeywords, attempt, "already_in_live_room", targetRoom)) {
          logger.info("target live search already in target live room", { attempt: attempt, keyword: keyword });
          setTargetLiveSearchResult("room_verified", {
            keyword: keyword,
            targetKeywords: targetKeywords,
            attempt: attempt,
            elapsedMs: Date.now() - startedAt,
            source: "already_in_live_room"
          });
          return true;
        }
        logger.warn("current live room is not target room, exit before target search", {
          attempt: attempt,
          keyword: keyword
        });
        setTargetLiveSearchResult("current_live_room_not_matched", {
          keyword: keyword,
          targetKeywords: targetKeywords,
          attempt: attempt
        });
        back();
        autojsUtils.sleepRandom(1200, 1800);
      }

      if (recoverSearchResultIssue(keyword, attempt, "target_live_search_loop")) {
        ensureTargetLiveSearchComprehensiveTab(keyword, attempt);
        continue;
      }
      if (isInterrupted("attempt_" + attempt + "_after_recover")) {
        return false;
      }

      if (hasAccountTargetRoom(targetRoom) && clickTargetUserLiveEntryFromSearch(keyword, targetKeywords, targetRoom, attempt)) {
        setTargetLiveSearchResult("room_verified", {
          keyword: keyword,
          targetKeywords: targetKeywords,
          attempt: attempt,
          elapsedMs: Date.now() - startedAt,
          source: "target_user_live_entry"
        });
        return true;
      }
      if (isInterrupted("attempt_" + attempt + "_after_user_entry")) {
        return false;
      }

      if (!hasAccountTargetRoom(targetRoom) && clickKeywordUserLiveEntryFromSearch(keyword, targetKeywords, targetRoom, attempt)) {
        setTargetLiveSearchResult("room_verified", {
          keyword: keyword,
          targetKeywords: targetKeywords,
          attempt: attempt,
          elapsedMs: Date.now() - startedAt,
          source: "keyword_user_live_entry"
        });
        return true;
      }
      if (isInterrupted("attempt_" + attempt + "_after_keyword_user_entry")) {
        return false;
      }

      if (clickVisibleTargetLiveBadgeCardFromSearch(keyword, targetKeywords, targetRoom, attempt)) {
        setTargetLiveSearchResult("room_verified", {
          keyword: keyword,
          targetKeywords: targetKeywords,
          attempt: attempt,
          elapsedMs: Date.now() - startedAt,
          source: "visible_live_badge_card"
        });
        return true;
      }
      if (isInterrupted("attempt_" + attempt + "_after_badge_card")) {
        return false;
      }

      if (clickVisibleTargetLiveCardFromSearch(keyword, targetKeywords, targetRoom, attempt)) {
        setTargetLiveSearchResult("room_verified", {
          keyword: keyword,
          targetKeywords: targetKeywords,
          attempt: attempt,
          elapsedMs: Date.now() - startedAt,
          source: "visible_target_live_card"
        });
        return true;
      }
      if (isInterrupted("attempt_" + attempt + "_after_live_card")) {
        return false;
      }

      if (clickVisibleTargetLiveCardByTextFallback(keyword, targetKeywords, targetRoom, attempt)) {
        setTargetLiveSearchResult("room_verified", {
          keyword: keyword,
          targetKeywords: targetKeywords,
          attempt: attempt,
          elapsedMs: Date.now() - startedAt,
          source: "text_coordinate_fallback"
        });
        return true;
      }
      if (isInterrupted("attempt_" + attempt + "_after_text_fallback")) {
        return false;
      }

      if (clickVisibleTargetLiveCardByOcrFallback(keyword, targetKeywords, targetRoom, attempt)) {
        setTargetLiveSearchResult("room_verified", {
          keyword: keyword,
          targetKeywords: targetKeywords,
          attempt: attempt,
          elapsedMs: Date.now() - startedAt,
          source: "ocr_coordinate_fallback"
        });
        return true;
      }
      if (isInterrupted("attempt_" + attempt + "_after_ocr_fallback")) {
        return false;
      }

      var entry = findTargetLiveSearchEntry(targetKeywords, targetRoom);
      if (entry && clickTargetLiveSearchEntry(entry, keyword, targetKeywords, targetRoom, attempt)) {
        setTargetLiveSearchResult("room_verified", {
          keyword: keyword,
          targetKeywords: targetKeywords,
          attempt: attempt,
          elapsedMs: Date.now() - startedAt,
          source: "target_live_search_entry"
        });
        return true;
      }

      if (attempt < 4) {
        logger.warn("target live search entry not found on comprehensive tab, scroll current results", {
          attempt: attempt,
          keyword: keyword,
          targetKeywords: targetKeywords,
          textSample: extractVisibleText().slice(0, 180)
        });
        advanceTargetLiveSearchResults(keyword, attempt);
        if (isInterrupted("attempt_" + attempt + "_after_scroll")) {
          return false;
        }
      }
    }

    var finalReason = lastTargetLiveSearchResult && lastTargetLiveSearchResult.reason &&
      lastTargetLiveSearchResult.reason !== "target_search_started" ?
      lastTargetLiveSearchResult.reason :
      "target_live_card_not_found";
    setTargetLiveSearchResult(finalReason, {
      keyword: keyword,
      targetKeywords: targetKeywords,
      elapsedMs: Date.now() - startedAt,
      textSample: extractVisibleText().slice(0, 220)
    });
    logger.warn("target live search failed to enter live room", {
      reason: finalReason,
      keyword: keyword,
      targetKeywords: targetKeywords,
      textSample: extractVisibleText().slice(0, 220)
    });
    return false;
  }

  function clickTargetUserLiveEntryFromSearch(keyword, targetKeywords, targetRoom, attempt) {
    var block = findTargetUserSearchBlock(targetKeywords, targetRoom);
    return clickUserLiveEntryBlock(block, keyword, targetKeywords, targetRoom, attempt, "target_user_live_entry");
  }

  function clickKeywordUserLiveEntryFromSearch(keyword, targetKeywords, targetRoom, attempt) {
    var block = findKeywordUserSearchBlock(keyword, targetRoom);
    if (!block) {
      return false;
    }
    var blockText = [block.targetText || "", block.contextText || ""].join("\n");
    if (targetKeywords && targetKeywords.length && !hasTargetTextMatch(blockText, targetKeywords, targetRoom)) {
      logger.info("keyword user block does not match target keywords, skip", {
        keyword: keyword,
        attempt: attempt,
        targetKeywords: targetKeywords,
        targetText: block.targetText.slice(0, 80),
        contextText: block.contextText.slice(0, 180)
      });
      setTargetLiveSearchResult("keyword_user_block_not_matched", {
        keyword: keyword,
        targetKeywords: targetKeywords,
        attempt: attempt,
        candidateType: "keyword_user_block",
        targetText: block.targetText.slice(0, 80),
        contextText: block.contextText.slice(0, 180)
      });
      return false;
    }
    return clickUserLiveEntryBlock(block, keyword, targetKeywords, targetRoom, attempt, "keyword_user_live_entry");
  }

  function clickUserLiveEntryBlock(block, keyword, targetKeywords, targetRoom, attempt, sourceName) {
    if (!block) {
      return false;
    }

    logger.info("target user block detected on search results", {
      keyword: keyword,
      attempt: attempt,
      source: sourceName,
      targetText: block.targetText.slice(0, 80),
      contextText: block.contextText.slice(0, 180),
      bounds: autojsUtils.formatBounds(block.bounds),
      liveHit: block.liveHit,
      liveReason: block.liveReason || ""
    });

    if (!block.liveHit) {
      logger.info("target user block has no live entry, wait for current search result refresh", {
        keyword: keyword,
        attempt: attempt,
        bounds: autojsUtils.formatBounds(block.bounds)
      });
      setTargetLiveSearchResult("target_user_not_live", {
        keyword: keyword,
        targetKeywords: targetKeywords,
        attempt: attempt,
        candidateType: sourceName || "target_user_block",
        targetText: block.targetText.slice(0, 80),
        contextText: block.contextText.slice(0, 180)
      });
      return false;
    }

    var points = buildTargetUserLiveClickPoints(block);
    for (var i = 0; i < points.length; i++) {
      var clickSource = (sourceName || "target_user_live_entry") + "_" + points[i].name;
      logger.info("click target user live entry", {
        keyword: keyword,
        attempt: attempt,
        source: sourceName,
        point: points[i].name,
        x: points[i].x,
        y: points[i].y,
        liveReason: block.liveReason || "",
        bounds: autojsUtils.formatBounds(block.bounds)
      });
      rememberPendingTargetLiveEntry(keyword, targetKeywords, {
        text: block.targetText,
        contextText: block.contextText,
        bounds: block.bounds
      }, clickSource);
      autojsUtils.clickPoint(points[i].x, points[i].y, logger, clickSource);
      autojsUtils.sleepRandom(3000, 5000);
      var afterText = extractVisibleText();
      if (isEndedTargetLiveRoomText(afterText, targetKeywords)) {
        logger.warn("target live entry opened ended live room, back and refresh results", {
          keyword: keyword,
          attempt: attempt,
          point: points[i].name,
          textSample: afterText.slice(0, 180)
        });
        if (!isSearchResultPage(afterText)) {
          back();
          autojsUtils.sleepRandom(1000, 1600);
        }
        refreshSearchResultsPage(keyword, attempt);
        return false;
      }
      if (!isSearchResultPage(afterText) && confirmTargetLiveRoom(keyword, targetKeywords, attempt, clickSource, targetRoom)) {
        return true;
      }
      if (!isSearchResultPage(afterText)) {
        logger.warn("target user live entry click did not confirm live room, back to search results", {
          keyword: keyword,
          attempt: attempt,
          point: points[i].name,
          textSample: afterText.slice(0, 180)
        });
        back();
        autojsUtils.sleepRandom(900, 1400);
      }
    }
    return false;
  }

  function findTargetUserSearchBlock(targetKeywords, targetRoom) {
    var keywords = buildTargetUserSearchKeywords(targetKeywords, targetRoom);
    return findUserSearchBlockByKeywords(keywords, "target_user", targetRoom);
  }

  function findKeywordUserSearchBlock(keyword, targetRoom) {
    var keywords = buildKeywordUserSearchKeywords(keyword, targetRoom);
    return findUserSearchBlockByKeywords(keywords, "keyword_user", targetRoom);
  }

  function findUserSearchBlockByKeywords(keywords, sourceName, targetRoom) {
    keywords = keywords || [];
    if (!keywords.length) {
      return null;
    }
    var nodes = [];
    for (var i = 0; i < keywords.length; i++) {
      pushFoundNodes(nodes, textContains(keywords[i]));
      pushFoundNodes(nodes, descContains(keywords[i]));
    }
    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    var samples = [];
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds || !isTargetSearchBoundsAllowed(bounds, screen)) {
        continue;
      }
      var textValue = getNodeOwnText(node);
      var contextText = collectNodeContextText(node, 5);
      var combined = [textValue, contextText].join("\n");
      var keywordHit = hasTargetTextMatch(combined, keywords, targetRoom);
      if (!keywordHit) {
        continue;
      }
      var userLike = /粉丝|抖音号|关注|用户/.test(combined) || bounds.centerY() < screen.height * 0.42;
      var liveInfo = detectTargetUserLiveInfo(node, bounds, combined, screen);
      var score = 50;
      if (userLike) {
        score += 25;
      }
      if (liveInfo.liveHit) {
        score += 45;
      }
      if (bounds.centerY() >= screen.height * 0.14 && bounds.centerY() <= screen.height * 0.52) {
        score += 10;
      }
      if (samples.length < 8) {
        samples.push({
          text: textValue.slice(0, 50),
          contextText: contextText.slice(0, 100),
          bounds: autojsUtils.formatBounds(bounds),
          userLike: userLike,
          liveHit: liveInfo.liveHit,
          score: score
        });
      }
      if (score > bestScore) {
        bestScore = score;
        best = {
          node: node,
          bounds: bounds,
          targetText: textValue,
          contextText: contextText,
          liveHit: liveInfo.liveHit,
          liveReason: liveInfo.reason,
          score: score
        };
      }
    }
    logger.info("target user search block scanned", {
      source: sourceName || "",
      keywords: keywords,
      total: nodes.length,
      selected: !!best,
      bestScore: bestScore,
      samples: samples
    });
    return bestScore >= 60 ? best : null;
  }

  function buildTargetUserSearchKeywords(targetKeywords, targetRoom) {
    var result = [];
    addTargetKeyword(result, targetRoom && targetRoom.anchorName);
    addTargetKeyword(result, targetRoom && targetRoom.anchorId);
    addTargetKeyword(result, targetRoom && targetRoom.douyinId);
    addTargetKeyword(result, targetRoom && targetRoom.accountId);
    return result;
  }

  function buildKeywordUserSearchKeywords(keyword, targetRoom) {
    var result = [];
    addTargetKeywordList(result, targetRoom && targetRoom.searchKeywords);
    addTargetKeyword(result, keyword);
    return result;
  }

  function detectTargetUserLiveInfo(node, targetBounds, contextText, screen) {
    var textLive = containsLiveEntryText(contextText) || /正在直播|直播中|开播中|直播\s*$/.test(String(contextText || ""));
    if (textLive) {
      return { liveHit: true, reason: "text_live_marker" };
    }
    var nearbyLiveNode = findNearbyLiveMarkerNode(targetBounds, screen);
    if (nearbyLiveNode) {
      return { liveHit: true, reason: "nearby_live_marker" };
    }
    var visualCard = hasLikelyLiveVisualCardBelow(targetBounds, screen);
    if (visualCard) {
      return { liveHit: true, reason: "visual_card_below_target" };
    }
    return { liveHit: false, reason: "" };
  }

  function findNearbyLiveMarkerNode(targetBounds, screen) {
    var nodes = [];
    pushFoundNodes(nodes, textMatches(".*(直播|直播中|正在直播).*"));
    pushFoundNodes(nodes, descMatches(".*(直播|直播中|正在直播).*"));
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds || !isTargetSearchBoundsAllowed(bounds, screen)) {
        continue;
      }
      if (bounds.centerY() < Math.max(screen.height * 0.13, targetBounds.top - screen.height * 0.08)) {
        continue;
      }
      if (bounds.centerY() > targetBounds.bottom + screen.height * 0.36) {
        continue;
      }
      return node;
    }
    return null;
  }

  function hasLikelyLiveVisualCardBelow(targetBounds, screen) {
    if (!targetBounds || !screen) {
      return false;
    }
    var visibleText = extractVisibleText();
    return /直播中|正在直播|正在\s*直播|正在直播间|直播[，,\s]*按钮/.test(visibleText);
  }

  function buildTargetUserLiveClickPoints(block) {
    var screen = autojsUtils.getScreenSize();
    var bounds = block.bounds;
    var anchorY = bounds && bounds.centerY ? bounds.centerY() : Math.floor(screen.height * 0.25);
    var imageTop = bounds ? Math.max(bounds.bottom + Math.floor(screen.height * 0.03), Math.floor(screen.height * 0.32)) : Math.floor(screen.height * 0.35);
    var imageY = Math.min(Math.floor(screen.height * 0.66), imageTop + Math.floor(screen.height * 0.18));
    return [
      { name: "target_avatar_live", x: Math.floor(screen.width * 0.13), y: Math.floor(anchorY) },
      { name: "target_user_row", x: Math.floor(screen.width * 0.36), y: Math.floor(anchorY) },
      { name: "target_live_card_center", x: Math.floor(screen.width * 0.36), y: imageY },
      { name: "target_live_card_upper", x: Math.floor(screen.width * 0.36), y: Math.max(Math.floor(screen.height * 0.34), imageY - Math.floor(screen.height * 0.10)) },
      { name: "target_live_card_right_badge", x: Math.floor(screen.width * 0.58), y: Math.max(Math.floor(screen.height * 0.34), imageY - Math.floor(screen.height * 0.12)) }
    ];
  }

  function isEndedTargetLiveRoomText(textValue, targetKeywords) {
    textValue = String(textValue || "");
    return /下场直播更精彩|开播通知我|直播已结束|暂未开播/.test(textValue) &&
      (!targetKeywords || !targetKeywords.length || containsAnyTargetKeyword(textValue, targetKeywords));
  }

  function refreshSearchResultsPage(keyword, attempt) {
    var screen = autojsUtils.getScreenSize();
    logger.info("refresh target live search result page", {
      keyword: keyword,
      attempt: attempt,
      screen: autojsUtils.describeScreenSize()
    });
    try {
      swipe(
        Math.floor(screen.width * 0.50),
        Math.floor(screen.height * 0.36),
        Math.floor(screen.width * 0.50),
        Math.floor(screen.height * 0.72),
        520
      );
      autojsUtils.sleepRandom(1800, 2800);
      return true;
    } catch (error) {
      logger.warn("refresh target live search result page failed", {
        keyword: keyword,
        attempt: attempt,
        message: String(error)
      });
    }
    return false;
  }

  function advanceTargetLiveSearchResults(keyword, attempt) {
    var screen = autojsUtils.getScreenSize();
    logger.info("scroll target live search comprehensive results", {
      keyword: keyword,
      attempt: attempt,
      screen: autojsUtils.describeScreenSize()
    });
    try {
      swipe(
        Math.floor(screen.width * 0.50),
        Math.floor(screen.height * 0.76),
        Math.floor(screen.width * 0.50),
        Math.floor(screen.height * 0.34),
        520
      );
      autojsUtils.sleepRandom(1600, 2400);
      recoverSearchResultIssue(keyword, attempt, "after_scroll");
      return true;
    } catch (error) {
      logger.warn("scroll target live search comprehensive results failed", {
        keyword: keyword,
        attempt: attempt,
        message: String(error)
      });
    }
    return false;
  }

  function ensureTargetLiveSearchComprehensiveTab(keyword, attempt) {
    var visibleText = extractVisibleText();
    var searchState = screenRecognizer.detectSearchPageState(visibleText, recognitionOptions());
    if (!searchState.isResult) {
      return false;
    }
    if (!hasStandaloneLine(visibleText, "综合")) {
      return false;
    }
    return switchTargetLiveSearchTab("综合", keyword, attempt);
  }

  function recoverSearchResultIssue(keyword, attempt, source) {
    var visibleText = extractVisibleText();
    if (!isRecoverableSearchResultIssue(visibleText)) {
      return false;
    }
    logger.warn("search result page needs retry recovery", {
      keyword: keyword,
      attempt: attempt,
      source: source || "",
      textSample: visibleText.slice(0, 220)
    });
    if (clickSearchRetryButton(keyword, attempt, source)) {
      autojsUtils.sleepRandom(2200, 3600);
      return true;
    }
    refreshSearchResultsPage(keyword, attempt);
    return true;
  }

  function isRecoverableSearchResultIssue(visibleText) {
    visibleText = String(visibleText || "");
    if (/网络异常|网络不给力|连接失败|加载失败|请求失败|点击重试|重试|重新加载|服务异常|系统繁忙|页面加载失败/.test(visibleText)) {
      return true;
    }
    var searchState = screenRecognizer.detectSearchPageState(visibleText, recognitionOptions());
    if (!searchState.hasSearchHeader && !searchState.hasTabs) {
      return false;
    }
    var lines = normalizeVisibleLines(visibleText);
    if (searchState.hasSearchHeader && searchState.hasTabs && lines.length <= 8 && !/直播中|正在直播|进入直播间|点击进入直播间/.test(visibleText)) {
      return true;
    }
    return false;
  }

  function clickSearchRetryButton(keyword, attempt, source) {
    var nodes = [];
    pushFoundNodes(nodes, textMatches(".*(点击重试|重试|重新加载|刷新).*"));
    pushFoundNodes(nodes, descMatches(".*(点击重试|重试|重新加载|刷新).*"));
    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    var samples = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds) {
        continue;
      }
      var centerY = bounds.centerY();
      if (centerY < screen.height * 0.12 || centerY > screen.height * 0.88) {
        continue;
      }
      var value = getNodeOwnText(node);
      var score = 0;
      if (/点击重试|重试|重新加载/.test(value)) {
        score += 50;
      }
      if (/刷新/.test(value)) {
        score += 20;
      }
      if (node.clickable && node.clickable()) {
        score += 8;
      }
      if (bounds.centerX() > screen.width * 0.18 && bounds.centerX() < screen.width * 0.82) {
        score += 6;
      }
      if (samples.length < 6) {
        samples.push({
          text: value.slice(0, 40),
          bounds: autojsUtils.formatBounds(bounds),
          score: score
        });
      }
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    if (!best || bestScore < 20) {
      logger.warn("search retry button not found", {
        keyword: keyword,
        attempt: attempt,
        source: source || "",
        samples: samples
      });
      return false;
    }
    logger.info("click search retry button", {
      keyword: keyword,
      attempt: attempt,
      source: source || "",
      score: bestScore,
      bounds: autojsUtils.formatBounds(best.bounds && best.bounds()),
      samples: samples
    });
    return autojsUtils.safeClick(best, 4, logger);
  }

  function switchTargetLiveSearchTab(tabName, keyword, attempt) {
    var tabNode = findSearchResultTab(tabName);
    if (!tabNode) {
      logger.warn("target live search tab not found", {
        tabName: tabName,
        keyword: keyword,
        attempt: attempt,
        textSample: extractVisibleText().slice(0, 180)
      });
      return false;
    }
    logger.info("target live search switch tab", {
      tabName: tabName,
      keyword: keyword,
      attempt: attempt,
      bounds: autojsUtils.formatBounds(tabNode.bounds && tabNode.bounds())
    });
    autojsUtils.safeClick(tabNode, 3, logger);
    autojsUtils.sleepRandom(1400, 2200);
    return true;
  }

  function findSearchResultTab(tabName) {
    var nodes = [];
    pushFoundNodes(nodes, text(tabName));
    pushFoundNodes(nodes, desc(tabName));
    pushFoundNodes(nodes, textContains(tabName));
    pushFoundNodes(nodes, descContains(tabName));
    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds) {
        continue;
      }
      var centerY = bounds.centerY();
      if (centerY < screen.height * 0.06 || centerY > screen.height * 0.28) {
        continue;
      }
      var ownText = getNodeOwnText(node);
      var score = 0;
      if (ownText === tabName) {
        score += 40;
      } else if (ownText.indexOf(tabName) >= 0) {
        score += 20;
      }
      if (bounds.width() >= 40 && bounds.width() <= screen.width * 0.35) {
        score += 10;
      }
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }
    return bestScore >= 20 ? best : null;
  }

  function clickVisibleTargetLiveBadgeCardFromSearch(keyword, targetKeywords, targetRoom, attempt) {
    var visibleText = extractVisibleText();
    var searchState = screenRecognizer.detectSearchPageState(visibleText, recognitionOptions());
    if (!searchState.isResult) {
      return false;
    }

    var targetBlock = hasAccountTargetRoom(targetRoom) ? findTargetUserSearchBlock(targetKeywords, targetRoom) : null;
    if (!isReliableTargetUserBlock(targetBlock)) {
      targetBlock = null;
    }
    var candidates = findVisibleLiveBadgeCardCandidates(targetKeywords, targetBlock);
    if (!candidates.length) {
      var reason = containsAnyTargetKeyword(visibleText, targetKeywords) ? "target_live_badge_not_found" : "target_not_found";
      setTargetLiveSearchResult(reason, {
        keyword: keyword,
        targetKeywords: targetKeywords,
        attempt: attempt,
        textSample: visibleText.slice(0, 220)
      });
      return false;
    }

    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (!candidate.targetHit) {
        continue;
      }
      logger.info("target live badge card detected on search results", {
        keyword: keyword,
        attempt: attempt,
        candidateType: candidate.type,
        liveText: candidate.liveText,
        candidateText: candidate.contextText.slice(0, 180),
        bounds: formatPlainRect(candidate.bounds),
        badgeBounds: formatPlainRect(candidate.badgeBounds),
        targetHit: candidate.targetHit
      });
      setTargetLiveSearchResult("target_live_card_found", {
        keyword: keyword,
        targetKeywords: targetKeywords,
        attempt: attempt,
        candidateType: candidate.type,
        candidateText: candidate.contextText.slice(0, 180),
        bounds: formatPlainRect(candidate.bounds)
      });
      if (clickLiveBadgeCardCandidate(candidate, keyword, targetKeywords, attempt)) {
        return true;
      }
    }

    setTargetLiveSearchResult("target_live_card_click_failed", {
      keyword: keyword,
      targetKeywords: targetKeywords,
      attempt: attempt,
      candidateCount: candidates.length,
      textSample: visibleText.slice(0, 220)
    });
    return false;
  }

  function findVisibleLiveBadgeCardCandidates(targetKeywords, targetBlock) {
    var screen = autojsUtils.getScreenSize();
    var nodes = [];
    pushFoundNodes(nodes, textMatches(".*(直播中|正在直播|开播中|LIVE|live).*"));
    pushFoundNodes(nodes, descMatches(".*(直播中|正在直播|开播中|LIVE|live).*"));

    var candidates = [];
    var seen = {};
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var bounds = node && node.bounds && node.bounds();
      var textValue = getNodeOwnText(node);
      if (!liveCardGeometry.isSearchLiveBadgeText(textValue, bounds, screen)) {
        continue;
      }
      var candidate = liveCardGeometry.buildLiveCardCandidateFromBadge(screen, bounds, {
        targetBounds: targetBlock && targetBlock.bounds
      });
      if (!candidate || !candidate.bounds) {
        continue;
      }
      if (candidate.type === "user_live_row") {
        continue;
      }
      var key = [candidate.type, candidate.bounds.left, candidate.bounds.top, candidate.bounds.right, candidate.bounds.bottom].join(":");
      if (seen[key]) {
        continue;
      }
      seen[key] = true;
      candidate.liveText = textValue;
      candidate.contextText = collectLiveCardCandidateText(candidate, node, targetBlock);
      candidate.targetHit = liveCardGeometry.matchesTargetKeywords(candidate.contextText, targetKeywords) ||
        (!!targetBlock && candidate.type === "user_large_live_card" && containsAnyTargetKeyword(targetBlock.contextText || targetBlock.targetText || "", targetKeywords));
      candidates.push(candidate);
    }

    candidates.sort(function (a, b) {
      if (a.targetHit !== b.targetHit) {
        return a.targetHit ? -1 : 1;
      }
      if (a.type !== b.type) {
        return a.type === "user_large_live_card" ? -1 : 1;
      }
      return a.bounds.top - b.bounds.top;
    });

    logger.info("visible live badge card candidates scanned", {
      total: nodes.length,
      selected: candidates.length,
      samples: summarizeLiveBadgeCandidates(candidates, 6)
    });
    return candidates;
  }

  function summarizeLiveBadgeCandidates(candidates, limit) {
    var samples = [];
    var max = Math.min(candidates.length, limit || 6);
    for (var i = 0; i < max; i++) {
      var candidate = candidates[i];
      samples.push({
        type: candidate.type,
        liveText: candidate.liveText,
        contextText: candidate.contextText.slice(0, 100),
        targetHit: candidate.targetHit,
        bounds: formatPlainRect(candidate.bounds),
        badgeBounds: formatPlainRect(candidate.badgeBounds)
      });
    }
    return samples;
  }

  function isReliableTargetUserBlock(block) {
    if (!block || !block.bounds) {
      return false;
    }
    var screen = autojsUtils.getScreenSize();
    var centerY = block.bounds.centerY();
    var contextText = String(block.contextText || block.targetText || "");
    if (centerY < screen.height * 0.15 || centerY > screen.height * 0.58) {
      return false;
    }
    if (/粉丝|抖音号|关注|用户/.test(contextText)) {
      return true;
    }
    return !!block.liveHit && centerY > screen.height * 0.20;
  }

  function collectLiveCardCandidateText(candidate, badgeNode, targetBlock) {
    var texts = [];
    appendCandidateText(texts, candidate.liveText);
    appendCandidateText(texts, collectNodeContextText(badgeNode, 4));
    appendCandidateText(texts, collectVisibleTextNearRect(candidate.bounds));
    if (targetBlock && candidate.type === "user_large_live_card") {
      appendCandidateText(texts, targetBlock.targetText);
      appendCandidateText(texts, targetBlock.contextText);
    }
    return uniqueTextLines(texts).join("\n");
  }

  function collectVisibleTextNearRect(rect) {
    if (!rect) {
      return "";
    }
    var screen = autojsUtils.getScreenSize();
    var scanRect = {
      left: Math.max(0, rect.left - Math.floor(screen.width * 0.03)),
      top: Math.max(0, rect.top - Math.floor(screen.height * 0.02)),
      right: Math.min(screen.width, rect.right + Math.floor(screen.width * 0.03)),
      bottom: Math.min(screen.height, rect.bottom + Math.floor(screen.height * 0.18))
    };
    var texts = [];
    var nodes = [];
    pushFoundNodes(nodes, className("android.widget.TextView"));
    pushFoundNodes(nodes, descMatches(".+"));
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds) {
        continue;
      }
      var centerX = bounds.centerX();
      var centerY = bounds.centerY();
      if (centerX < scanRect.left || centerX > scanRect.right || centerY < scanRect.top || centerY > scanRect.bottom) {
        continue;
      }
      appendCandidateText(texts, getNodeOwnText(node));
    }
    return uniqueTextLines(texts).join("\n");
  }

  function appendCandidateText(texts, value) {
    value = String(value || "").replace(/\s+/g, " ").trim();
    if (value) {
      texts.push(value);
    }
  }

  function clickLiveBadgeCardCandidate(candidate, keyword, targetKeywords, attempt) {
    var points = candidate.clickPoints || [];
    for (var i = 0; i < points.length; i++) {
      var point = points[i];
      logger.info("click target live badge card", {
        keyword: keyword,
        attempt: attempt,
        candidateType: candidate.type,
        point: point.name,
        x: point.x,
        y: point.y,
        bounds: formatPlainRect(candidate.bounds),
        badgeBounds: formatPlainRect(candidate.badgeBounds)
      });
      rememberPendingTargetLiveEntry(keyword, targetKeywords, {
        text: candidate.liveText,
        contextText: candidate.contextText,
        bounds: candidate.bounds
      }, "live_badge_card_" + point.name);
      autojsUtils.clickPoint(point.x, point.y, logger, "target_live_badge_card_" + point.name);
      autojsUtils.sleepRandom(2600, 4200);
      var afterText = extractVisibleText();
      if (isEndedTargetLiveRoomText(afterText, targetKeywords)) {
        logger.warn("target live badge card opened ended live room, back and continue search", {
          keyword: keyword,
          attempt: attempt,
          candidateType: candidate.type,
          point: point.name,
          textSample: afterText.slice(0, 180)
        });
        setTargetLiveSearchResult("target_user_not_live", {
          keyword: keyword,
          targetKeywords: targetKeywords,
          attempt: attempt,
          candidateType: candidate.type,
          point: point.name,
          textSample: afterText.slice(0, 180)
        });
        if (!isSearchResultPage(afterText)) {
          back();
          autojsUtils.sleepRandom(900, 1400);
        }
        continue;
      }
      if (isLiveRoomVisible() && confirmTargetLiveRoom(keyword, targetKeywords, attempt, "live_badge_card_" + point.name, targetRoom)) {
        logger.info("entered target live room from visible live badge card", {
          keyword: keyword,
          attempt: attempt,
          candidateType: candidate.type,
          point: point.name
        });
        return true;
      }
      if (!isSearchResultPage(afterText) && containsLiveEntryText(afterText) && hasTargetTextMatch(afterText, targetKeywords, targetRoom)) {
        logger.info("target page opened from live badge card, try visible live entry", {
          keyword: keyword,
          attempt: attempt,
          candidateType: candidate.type,
          point: point.name,
          textSample: afterText.slice(0, 180)
        });
        if (openLiveRoomFromCurrentScreen(afterText) && confirmTargetLiveRoom(keyword, targetKeywords, attempt, "current_screen_live_entry", targetRoom)) {
          return true;
        }
      }
      if (!isSearchResultPage(afterText)) {
        back();
        autojsUtils.sleepRandom(900, 1400);
      }
    }
    return false;
  }

  function formatPlainRect(rect) {
    if (!rect) {
      return "";
    }
    if (rect.left !== undefined && rect.top !== undefined && rect.right !== undefined && rect.bottom !== undefined) {
      return "[" + rect.left + "," + rect.top + "][" + rect.right + "," + rect.bottom + "]";
    }
    return autojsUtils.formatBounds(rect);
  }

  function clickVisibleTargetLiveCardFromSearch(keyword, targetKeywords, targetRoom, attempt) {
    var visibleText = extractVisibleText();
    var searchState = screenRecognizer.detectSearchPageState(visibleText, recognitionOptions());
    var liveVisible = containsLiveEntryText(visibleText) || /直播[，,\s]*按钮/.test(visibleText);
    var keywordEntry = findVisibleTargetKeywordEntry(targetKeywords);
    if (!searchState.isResult || !keywordEntry || !liveVisible) {
      return false;
    }

    logger.info("target live room visible on comprehensive search tab, click result card directly", {
      keyword: keyword,
      attempt: attempt,
      liveVisible: liveVisible,
      searchState: searchState,
      keywordEntry: {
        text: keywordEntry.text.slice(0, 60),
        contextText: keywordEntry.contextText.slice(0, 120),
        bounds: autojsUtils.formatBounds(keywordEntry.bounds)
      },
      textSample: visibleText.slice(0, 220)
    });

    if (clickTargetLiveSearchCardFallback(keywordEntry, keyword, targetKeywords, targetRoom, attempt, visibleText)) {
      return true;
    }

    logger.warn("target live room visible but direct comprehensive card click failed", {
      keyword: keyword,
      attempt: attempt,
      textSample: extractVisibleText().slice(0, 220)
    });
    return false;
  }

  function clickVisibleTargetLiveCardByTextFallback(keyword, targetKeywords, targetRoom, attempt) {
    var visibleText = extractVisibleText();
    var searchState = screenRecognizer.detectSearchPageState(visibleText, recognitionOptions());
    var targetVisible = hasTargetTextMatch(visibleText, targetKeywords, targetRoom);
    var liveVisible = containsLiveEntryText(visibleText) || /直播[中间]|正在直播|直播[，,\s]*按钮/.test(visibleText);
    if (!searchState.isResult || !targetVisible || !liveVisible) {
      return false;
    }

    logger.warn("target live room visible by screen text, use coordinate fallback", {
      keyword: keyword,
      attempt: attempt,
      targetKeywords: targetKeywords,
      searchState: searchState,
      textSample: visibleText.slice(0, 260)
    });

    var screen = autojsUtils.getScreenSize();
    var entry = {
      text: keyword || "",
      contextText: visibleText,
      bounds: null
    };
    var points = liveCardGeometry.buildSearchResultLiveFallbackClickPoints(screen);

    for (var i = 0; i < points.length; i++) {
      var x = points[i].x;
      var y = points[i].y;
      rememberPendingTargetLiveEntry(keyword, targetKeywords, entry, points[i].name);
      autojsUtils.clickPoint(x, y, logger, "target_live_text_fallback_" + points[i].name);
      autojsUtils.sleepRandom(2600, 4200);
      var afterText = extractVisibleText();
      if (isEndedTargetLiveRoomText(afterText, targetKeywords)) {
        logger.warn("target live text fallback opened ended live room, back and continue search", {
          keyword: keyword,
          attempt: attempt,
          point: points[i].name,
          textSample: afterText.slice(0, 180)
        });
        if (!isSearchResultPage(afterText)) {
          back();
          autojsUtils.sleepRandom(900, 1400);
        }
        continue;
      }
      if (isLiveRoomVisible() && confirmTargetLiveRoom(keyword, targetKeywords, attempt, points[i].name, targetRoom)) {
        logger.info("entered target live room from text coordinate fallback", {
          keyword: keyword,
          attempt: attempt,
          point: points[i].name
        });
        return true;
      }
      if (!isSearchResultPage(afterText) && containsLiveEntryText(afterText) && hasTargetTextMatch(afterText, targetKeywords, targetRoom)) {
        logger.info("target page opened from text coordinate fallback, try visible live entry", {
          keyword: keyword,
          attempt: attempt,
          point: points[i].name,
          textSample: afterText.slice(0, 180)
        });
        if (openLiveRoomFromCurrentScreen(afterText) && confirmTargetLiveRoom(keyword, targetKeywords, attempt, "current_screen_live_entry", targetRoom)) {
          return true;
        }
      }
      if (!isSearchResultPage(afterText)) {
        back();
        autojsUtils.sleepRandom(900, 1400);
      }
    }
    return false;
  }

  function clickVisibleTargetLiveCardByOcrFallback(keyword, targetKeywords, targetRoom, attempt) {
    var visibleText = extractVisibleText();
    var searchState = screenRecognizer.detectSearchPageState(visibleText, recognitionOptions());
    var targetVisible = hasTargetTextMatch(visibleText, targetKeywords, targetRoom);
    if (!searchState.isResult || !targetVisible) {
      return false;
    }

    var screen = autojsUtils.getScreenSize();
    var regions = liveCardGeometry.buildSearchResultLiveOcrRegions(screen);
    var snapshot = null;
    try {
      snapshot = screenRecognizer.extractScreen(regions, recognitionOptions());
    } catch (error) {
      logger.warn("target live OCR fallback failed to capture regions", {
        keyword: keyword,
        attempt: attempt,
        message: String(error)
      });
      return false;
    }

    var regionHits = buildLiveOcrRegionHits(snapshot && snapshot.ocrRegions || {});
    if (!regionHits.length) {
      setTargetLiveSearchResult("target_live_ocr_badge_not_found", {
        keyword: keyword,
        targetKeywords: targetKeywords,
        attempt: attempt,
        searchState: searchState,
        textSample: visibleText.slice(0, 220),
        ocrSample: String(snapshot && snapshot.ocrText || "").slice(0, 220)
      });
      return false;
    }

    logger.warn("target live card visible by OCR, use search result coordinate fallback", {
      keyword: keyword,
      attempt: attempt,
      regionHits: regionHits,
      textSample: visibleText.slice(0, 180)
    });

    var entry = {
      text: keyword || "",
      contextText: [visibleText, snapshot && snapshot.ocrText || ""].join("\n"),
      bounds: null
    };
    var points = liveCardGeometry.buildSearchResultLiveFallbackClickPoints(screen);
    var filteredPoints = filterOcrFallbackClickPoints(points, regionHits);
    for (var i = 0; i < filteredPoints.length; i++) {
      var point = filteredPoints[i];
      rememberPendingTargetLiveEntry(keyword, targetKeywords, entry, "ocr_" + point.name);
      autojsUtils.clickPoint(point.x, point.y, logger, "target_live_ocr_fallback_" + point.name);
      autojsUtils.sleepRandom(2600, 4200);
      var afterText = extractVisibleText();
      if (isEndedTargetLiveRoomText(afterText, targetKeywords)) {
        logger.warn("target live OCR fallback opened ended live room, back and continue search", {
          keyword: keyword,
          attempt: attempt,
          point: point.name,
          textSample: afterText.slice(0, 180)
        });
        if (!isSearchResultPage(afterText)) {
          back();
          autojsUtils.sleepRandom(900, 1400);
        }
        continue;
      }
      if (isLiveRoomVisible() && confirmTargetLiveRoom(keyword, targetKeywords, attempt, "ocr_" + point.name, targetRoom)) {
        logger.info("entered target live room from OCR coordinate fallback", {
          keyword: keyword,
          attempt: attempt,
          point: point.name
        });
        return true;
      }
      if (!isSearchResultPage(afterText) && containsLiveEntryText(afterText) && hasTargetTextMatch(afterText, targetKeywords, targetRoom)) {
        logger.info("target page opened from OCR coordinate fallback, try visible live entry", {
          keyword: keyword,
          attempt: attempt,
          point: point.name,
          textSample: afterText.slice(0, 180)
        });
        if (openLiveRoomFromCurrentScreen(afterText) && confirmTargetLiveRoom(keyword, targetKeywords, attempt, "current_screen_live_entry", targetRoom)) {
          return true;
        }
      }
      if (!isSearchResultPage(afterText)) {
        back();
        autojsUtils.sleepRandom(900, 1400);
      }
    }
    return false;
  }

  function buildLiveOcrRegionHits(ocrRegions) {
    var hits = [];
    var keys = [
      "lowerRightLiveBadge",
      "lowerRightLiveCard",
      "lowerLeftLiveBadge",
      "lowerLeftLiveCard",
      "upperLiveCard"
    ];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var textValue = String(ocrRegions && ocrRegions[key] || "");
      if (containsLiveEntryText(textValue)) {
        hits.push({
          region: key,
          textSample: textValue.replace(/\s+/g, " ").slice(0, 80)
        });
      }
    }
    return hits;
  }

  function filterOcrFallbackClickPoints(points, regionHits) {
    var right = false;
    var left = false;
    var upper = false;
    for (var i = 0; i < regionHits.length; i++) {
      var region = String(regionHits[i].region || "");
      if (region.indexOf("lowerRight") === 0) {
        right = true;
      } else if (region.indexOf("lowerLeft") === 0) {
        left = true;
      } else if (region.indexOf("upper") === 0) {
        upper = true;
      }
    }
    var result = [];
    for (var j = 0; j < points.length; j++) {
      var point = points[j];
      var name = String(point.name || "");
      if ((right && name.indexOf("visible_lower_right") === 0) ||
        (left && name.indexOf("visible_lower_left") === 0) ||
        (upper && name.indexOf("visible_lower_") !== 0)) {
        result.push(point);
      }
    }
    if (!result.length) {
      return points;
    }
    return result;
  }

  function buildTargetRoomKeywords(targetRoom, fallbackKeyword) {
    var result = [];
    addTargetKeywordList(result, targetRoom && targetRoom.matchKeywords);
    if (result.length) {
      return result;
    }
    addTargetKeywordList(result, targetRoom && targetRoom.searchKeywords);
    if (result.length) {
      return result;
    }
    addTargetKeyword(result, targetRoom && targetRoom.anchorName);
    addTargetKeywordList(result, targetRoom && targetRoom.titleKeywords);
    addTargetKeywordList(result, targetRoom && targetRoom.roomKeywords);
    addTargetKeyword(result, fallbackKeyword);
    return result;
  }

  function pickTargetRoomSearchKeyword(targetRoom) {
    var result = [];
    addTargetKeywordList(result, targetRoom && targetRoom.searchKeywords);
    if (result.length) {
      return result[0];
    }
    addTargetKeyword(result, targetRoom && targetRoom.anchorName);
    addTargetKeywordList(result, targetRoom && targetRoom.titleKeywords);
    addTargetKeywordList(result, targetRoom && targetRoom.roomKeywords);
    return result.length ? result[0] : "";
  }

  function hasAccountTargetRoom(targetRoom) {
    var result = [];
    addTargetKeyword(result, targetRoom && targetRoom.anchorName);
    addTargetKeyword(result, targetRoom && targetRoom.anchorId);
    addTargetKeyword(result, targetRoom && targetRoom.douyinId);
    addTargetKeyword(result, targetRoom && targetRoom.accountId);
    return result.length > 0;
  }

  function addTargetKeywordList(result, values) {
    if (typeof values === "string") {
      values = values.split(/[\n,，]/);
    }
    if (!values || !values.length) {
      return;
    }
    for (var i = 0; i < values.length; i++) {
      addTargetKeyword(result, values[i]);
    }
  }

  function addTargetKeyword(result, value) {
    value = String(value || "").replace(/\s+/g, " ").trim();
    if (!value) {
      return;
    }
    for (var i = 0; i < result.length; i++) {
      if (result[i] === value) {
        return;
      }
    }
    result.push(value);
  }

  function findTargetLiveSearchEntry(targetKeywords, targetRoom) {
    var nodes = [];
    pushFoundNodes(nodes, textMatches(".*(进入直播间|点击进入直播间|正在直播|直播中|热聊中|讲解中|LIVE|live).*"));
    pushFoundNodes(nodes, descMatches(".*(进入直播间|点击进入直播间|正在直播|直播中|热聊中|讲解中|LIVE|live).*"));
    for (var i = 0; i < targetKeywords.length; i++) {
      pushFoundNodes(nodes, textContains(targetKeywords[i]));
      pushFoundNodes(nodes, descContains(targetKeywords[i]));
    }

    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    var samples = [];
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds || !isTargetSearchBoundsAllowed(bounds, screen)) {
        continue;
      }

      var textValue = getNodeOwnText(node);
      var contextText = collectNodeContextText(node, 4);
      var liveHit = containsLiveEntryText(textValue) || containsLiveEntryText(contextText);
      var targetHit = hasTargetTextMatch(contextText || textValue, targetKeywords, targetRoom);
      var score = 0;
      if (targetHit) {
        score += 60;
      }
      if (liveHit) {
        score += 45;
      }
      if (containsLiveEntryText(textValue)) {
        score += 12;
      }
      if (node.clickable && node.clickable()) {
        score += 5;
      }
      if (bounds.centerY() >= screen.height * 0.16 && bounds.centerY() <= screen.height * 0.62) {
        score += 4;
      }
      if (!targetHit && targetKeywords.length > 0) {
        score -= 80;
      }
      if (!liveHit && !hasTargetTextMatch(textValue, targetKeywords, targetRoom)) {
        score -= 40;
      }

      if (samples.length < 10) {
        samples.push({
          text: textValue.slice(0, 40),
          contextText: contextText.slice(0, 80),
          bounds: autojsUtils.formatBounds(bounds),
          targetHit: targetHit,
          liveHit: liveHit,
          score: score
        });
      }

      if (score > bestScore) {
        bestScore = score;
        best = {
          node: node,
          bounds: bounds,
          text: textValue,
          contextText: contextText,
          score: score,
          targetHit: targetHit,
          liveHit: liveHit
        };
      }
    }

    logger.info("target live search candidates scanned", {
      total: nodes.length,
      selected: !!best,
      bestScore: bestScore,
      samples: samples
    });

    if (!best || bestScore < 40 || (targetKeywords.length > 0 && !best.targetHit)) {
      return null;
    }
    return best;
  }

  function findVisibleTargetKeywordEntry(targetKeywords) {
    var nodes = [];
    for (var i = 0; i < targetKeywords.length; i++) {
      pushFoundNodes(nodes, textContains(targetKeywords[i]));
      pushFoundNodes(nodes, descContains(targetKeywords[i]));
    }

    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    var samples = [];
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds || !isTargetSearchBoundsAllowed(bounds, screen)) {
        continue;
      }

      var textValue = getNodeOwnText(node);
      if (!containsAnyTargetKeyword(textValue, targetKeywords)) {
        continue;
      }

      var centerY = bounds.centerY();
      var score = 0;
      if (centerY >= screen.height * 0.18 && centerY <= screen.height * 0.72) {
        score += 50;
      }
      if (centerY > screen.height * 0.28) {
        score += 20;
      }
      if (bounds.centerX() < screen.width * 0.80) {
        score += 8;
      }
      if (node.clickable && node.clickable()) {
        score += 3;
      }

      if (samples.length < 8) {
        samples.push({
          text: textValue.slice(0, 50),
          bounds: autojsUtils.formatBounds(bounds),
          score: score
        });
      }

      if (score > bestScore) {
        bestScore = score;
        best = {
          node: node,
          bounds: bounds,
          text: textValue,
          contextText: collectNodeContextText(node, 3),
          score: score,
          targetHit: true,
          liveHit: false
        };
      }
    }

    logger.info("target keyword search nodes scanned", {
      total: nodes.length,
      selected: !!best,
      bestScore: bestScore,
      samples: samples
    });
    return bestScore >= 40 ? best : null;
  }

  function clickTargetLiveSearchEntry(entry, keyword, targetKeywords, targetRoom, attempt) {
    logger.info("click target live search entry", {
      keyword: keyword,
      attempt: attempt,
      score: entry.score,
      targetHit: entry.targetHit,
      liveHit: entry.liveHit,
      text: entry.text.slice(0, 80),
      contextText: entry.contextText.slice(0, 160),
      bounds: autojsUtils.formatBounds(entry.bounds)
    });

    var currentText = extractVisibleText();
    if (containsLiveEntryText(currentText) && hasTargetTextMatch(currentText, targetKeywords, targetRoom)) {
      if (clickTargetLiveSearchCardFallback(entry, keyword, targetKeywords, targetRoom, attempt, currentText)) {
        return true;
      }
    }

    rememberPendingTargetLiveEntry(keyword, targetKeywords, entry, "node_click");
    autojsUtils.axisClick(entry.node, logger);
    autojsUtils.sleepRandom(2500, 4200);

    var visibleText = extractVisibleText();
    if (isLiveRoomVisible() && confirmTargetLiveRoom(keyword, targetKeywords, attempt, "node_click", targetRoom)) {
      logger.info("entered target live room from search", { keyword: keyword, attempt: attempt });
      return true;
    }

    if (containsLiveEntryText(visibleText) && hasTargetTextMatch(visibleText, targetKeywords, targetRoom)) {
      logger.info("target profile/result page opened, try live entry on current screen", {
        keyword: keyword,
        attempt: attempt,
        textSample: visibleText.slice(0, 180)
      });
      if (openLiveRoomFromCurrentScreen(visibleText) && confirmTargetLiveRoom(keyword, targetKeywords, attempt, "current_screen_live_entry", targetRoom)) {
        return true;
      }
    }

    logger.warn("target live search entry click did not enter live room, back to results", {
      keyword: keyword,
      attempt: attempt,
      textSample: extractVisibleText().slice(0, 180)
    });
    if (!isSearchResultPage(extractVisibleText())) {
      back();
      autojsUtils.sleepRandom(900, 1400);
    }
    return false;
  }

  function clickTargetLiveSearchCardFallback(entry, keyword, targetKeywords, targetRoom, attempt, visibleText) {
    var screen = autojsUtils.getScreenSize();
    var bounds = entry && entry.bounds;
    var anchorY = bounds && bounds.centerY ? bounds.centerY() : Math.floor(screen.height * 0.35);
    var cardY = Math.max(
      Math.floor(screen.height * 0.28),
      Math.min(Math.floor(anchorY + screen.height * 0.08), Math.floor(screen.height * 0.72))
    );
    var points = [
      { x: screen.width * 0.84, y: anchorY, name: "search_live_card_row_right" },
      { x: screen.width * 0.70, y: anchorY, name: "search_live_card_row_mid_right" },
      { x: screen.width * 0.30, y: anchorY, name: "search_live_card_row_left" },
      { x: screen.width * 0.36, y: cardY, name: "search_live_card_left" },
      { x: screen.width * 0.50, y: cardY, name: "search_live_card_center" },
      { x: screen.width * 0.84, y: cardY, name: "search_live_card_right" },
      { x: screen.width * 0.36, y: screen.height * 0.56, name: "search_live_card_mid_left" },
      { x: screen.width * 0.50, y: screen.height * 0.56, name: "search_live_card_mid_center" },
      { x: screen.width * 0.84, y: screen.height * 0.56, name: "search_live_card_mid_right" }
    ];

    for (var i = 0; i < points.length; i++) {
      var x = Math.floor(points[i].x);
      var y = Math.floor(points[i].y);
      logger.warn("target live result card coordinate fallback", {
        keyword: keyword,
        attempt: attempt,
        point: points[i].name,
        x: x,
        y: y,
        activity: safeCurrentActivity(),
        textSample: String(visibleText || "").slice(0, 160),
        entryBounds: autojsUtils.formatBounds(bounds)
      });
      rememberPendingTargetLiveEntry(keyword, targetKeywords, entry, points[i].name);
      autojsUtils.clickPoint(x, y, logger, "target_live_search_card_" + points[i].name);
      autojsUtils.sleepRandom(2600, 3800);
      var afterClickText = extractVisibleText();
      if (isLiveRoomVisible() && confirmTargetLiveRoom(keyword, targetKeywords, attempt, points[i].name, targetRoom)) {
        logger.info("entered target live room from search card coordinate", {
          keyword: keyword,
          attempt: attempt,
          point: points[i].name
        });
        return true;
      }
      if (!isSearchResultPage(afterClickText) && containsLiveEntryText(afterClickText) && hasTargetTextMatch(afterClickText, targetKeywords, targetRoom)) {
        logger.info("target page opened from search card, try visible live entry", {
          keyword: keyword,
          attempt: attempt,
          point: points[i].name,
          textSample: afterClickText.slice(0, 180)
        });
        if (openLiveRoomFromCurrentScreen(afterClickText) && confirmTargetLiveRoom(keyword, targetKeywords, attempt, "current_screen_live_entry", targetRoom)) {
          return true;
        }
      }
      if (!/SearchResult/i.test(safeCurrentActivity())) {
        back();
        autojsUtils.sleepRandom(900, 1400);
      }
    }
    return false;
  }

  function confirmTargetLiveRoom(keyword, targetKeywords, attempt, source, targetRoom) {
    var visibleText = extractVisibleText();
    var searchState = screenRecognizer.detectSearchPageState(visibleText, recognitionOptions());
    if (isLiveRoomVisible()) {
      if (hasTargetTextMatch(visibleText, targetKeywords, targetRoom)) {
        clearPendingTargetLiveEntry();
        return true;
      }
      if (isPendingTargetLiveEntryValid(keyword, targetKeywords, source)) {
        logger.info("entered live room scene by verified target search card", {
          keyword: keyword,
          attempt: attempt,
          source: source || "",
          textSample: visibleText.slice(0, 220)
        });
        clearPendingTargetLiveEntry();
        return true;
      }
    }
    if ((source === "node_click" || source === "current_screen_live_entry" || /^search_live_card_/.test(String(source || "")) || /^target_/.test(String(source || "")) || /^keyword_user_live_entry_/.test(String(source || "")) || /^live_badge_card_/.test(String(source || "")) || /^ocr_/.test(String(source || ""))) &&
      !searchState.isResult &&
      /说点什么|欢迎来到直播间|小黄车|粉丝团|礼物|连麦|本场点赞|直播广场/.test(visibleText) &&
      isPendingTargetLiveEntryValid(keyword, targetKeywords, source)) {
      logger.info("target live room navigation accepted by live room markers", {
        keyword: keyword,
        attempt: attempt,
        source: source || "",
        textSample: visibleText.slice(0, 220),
        searchState: searchState
      });
      clearPendingTargetLiveEntry();
      return true;
    }
    logger.warn("entered live room but target anchor not matched, exit and continue search", {
      keyword: keyword,
      attempt: attempt,
      source: source || "",
      targetKeywords: targetKeywords,
      textSample: visibleText.slice(0, 220)
    });
    back();
    autojsUtils.sleepRandom(1200, 1800);
    return false;
  }

  function rememberPendingTargetLiveEntry(keyword, targetKeywords, entry, source) {
    var textValue = String(entry && entry.text || "");
    var contextText = String(entry && entry.contextText || "");
    var combined = [textValue, contextText, keyword || ""].join(" ");
    if (!containsAnyTargetKeyword(combined, targetKeywords)) {
      return;
    }
    pendingTargetLiveEntry = {
      keyword: keyword || "",
      targetKeywords: targetKeywords || [],
      source: source || "",
      text: combined.slice(0, 240),
      at: Date.now()
    };
  }

  function clearPendingTargetLiveEntry() {
    pendingTargetLiveEntry = null;
  }

  function isPendingTargetLiveEntryValid(keyword, targetKeywords, source) {
    if (!pendingTargetLiveEntry || !pendingTargetLiveEntry.at || Date.now() - pendingTargetLiveEntry.at > 15000) {
      return false;
    }
    var sourceValue = String(source || "");
    if (sourceValue && pendingTargetLiveEntry.source && sourceValue !== pendingTargetLiveEntry.source && sourceValue.indexOf("search_live_card_") !== 0 && sourceValue.indexOf("live_badge_card_") !== 0 && sourceValue.indexOf("ocr_") !== 0) {
      return false;
    }
    var combined = [
      pendingTargetLiveEntry.keyword || "",
      pendingTargetLiveEntry.text || "",
      keyword || ""
    ].join(" ");
    return containsAnyTargetKeyword(combined, targetKeywords || pendingTargetLiveEntry.targetKeywords || []);
  }

  function containsLiveEntryText(value) {
    return /进入直播间|点击进入直播间|正在直播|直播中|热聊中|讲解中|直播[，,\s]*按钮|LIVE|live/i.test(String(value || ""));
  }

  function containsAnyTargetKeyword(value, keywords) {
    value = String(value || "");
    if (!keywords || !keywords.length) {
      return false;
    }
    for (var i = 0; i < keywords.length; i++) {
      if (keywords[i] && value.indexOf(keywords[i]) >= 0) {
        return true;
      }
    }
    return false;
  }

  function getNodeOwnText(node) {
    if (!node) {
      return "";
    }
    var values = [];
    try {
      var textValue = node.text && node.text();
      if (textValue) {
        values.push(textValue);
      }
    } catch (error) {
    }
    try {
      var descValue = node.desc && node.desc();
      if (descValue) {
        values.push(descValue);
      }
    } catch (error2) {
    }
    return values.join("\n");
  }

  function collectNodeContextText(node, maxParentDepth) {
    var texts = [];
    var current = node;
    var depth = 0;
    while (current && depth <= (maxParentDepth || 3)) {
      appendNodeTreeText(current, texts, 0, 2);
      try {
        current = current.parent && current.parent();
      } catch (error) {
        current = null;
      }
      depth += 1;
    }
    return uniqueTextLines(texts).join("\n");
  }

  function appendNodeTreeText(node, texts, depth, maxDepth) {
    if (!node || depth > maxDepth) {
      return;
    }
    var value = getNodeOwnText(node);
    if (value) {
      texts.push(value);
    }
    var count = 0;
    try {
      count = node.childCount && node.childCount() || 0;
    } catch (error) {
      count = 0;
    }
    for (var i = 0; i < count; i++) {
      try {
        appendNodeTreeText(node.child(i), texts, depth + 1, maxDepth);
      } catch (error2) {
      }
    }
  }

  function uniqueTextLines(values) {
    var result = [];
    for (var i = 0; i < values.length; i++) {
      var parts = String(values[i] || "").split(/\n+/);
      for (var j = 0; j < parts.length; j++) {
        var value = parts[j].replace(/\s+/g, " ").trim();
        if (!value) {
          continue;
        }
        var exists = false;
        for (var k = 0; k < result.length; k++) {
          if (result[k] === value) {
            exists = true;
            break;
          }
        }
        if (!exists) {
          result.push(value);
        }
      }
    }
    return result;
  }

  function isTargetSearchBoundsAllowed(bounds, screen) {
    if (!bounds || !screen) {
      return false;
    }
    if (bounds.width && bounds.width() <= 0) {
      return false;
    }
    if (bounds.height && bounds.height() <= 0) {
      return false;
    }
    var centerX = bounds.centerX();
    var centerY = bounds.centerY();
    return centerX >= screen.width * 0.04 &&
      centerX <= screen.width * 0.96 &&
      centerY >= screen.height * 0.10 &&
      centerY <= screen.height * 0.88;
  }

  function swipeSearchResultsUp() {
    var screen = autojsUtils.getScreenSize();
    try {
      swipe(
        Math.floor(screen.width * 0.52),
        Math.floor(screen.height * 0.78),
        Math.floor(screen.width * 0.52),
        Math.floor(screen.height * 0.36),
        420
      );
    } catch (error) {
      logger.warn("search result swipe failed", { message: String(error) });
      return false;
    }
    autojsUtils.sleepRandom(900, 1400);
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

  function openLiveRoomFromCurrentScreen(visibleTextHint) {
    var entryNode = findLiveRoomEntryNode();

    if (entryNode) {
      var entryBounds = entryNode.bounds && entryNode.bounds();
      logger.info("找到直播入口控件，尝试点击进入直播间", {
        text: entryNode.text && entryNode.text(),
        desc: entryNode.desc && entryNode.desc(),
        bounds: autojsUtils.formatBounds(entryBounds)
      });
      autojsUtils.axisClick(entryNode, logger);
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

    if (tryLiveEntryFallback(visibleTextHint)) {
      return true;
    }

    logger.info("未找到明确直播入口控件，不进入当前候选");
    return false;
  }

  function findLiveRoomEntryNode() {
    var nodes = [];
    pushFoundNodes(nodes, textMatches(".*(进入直播间|直播中|热聊中|讲解中|直播[，,\\s]*按钮).*"));
    pushFoundNodes(nodes, descMatches(".*(进入直播间|直播中|热聊中|讲解中|直播[，,\\s]*按钮).*"));

    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    var samples = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds) {
        continue;
      }
      var value = String((node.text && node.text()) || (node.desc && node.desc()) || "");
      if (samples.length < 8) {
        samples.push({
          text: value.slice(0, 30),
          bounds: autojsUtils.formatBounds(bounds),
          clickable: !!(node.clickable && node.clickable())
        });
      }
      if (!isLiveEntryBoundsAllowed(bounds, screen)) {
        continue;
      }

      var centerY = bounds.centerY();
      var score = 0;
      if (/点击进入直播间/.test(value)) {
        score += 30;
      } else if (/进入直播间/.test(value)) {
        score += 24;
      } else if (/直播[，,\s]*按钮/.test(value)) {
        score += 18;
      } else if (/直播中|热聊中|讲解中/.test(value)) {
        score += 12;
      }
      if (centerY >= screen.height * 0.16 && centerY <= screen.height * 0.62) {
        score += 10;
      }
      if (bounds.width && bounds.width() >= screen.width * 0.08) {
        score += 3;
      }
      if (node.clickable && node.clickable()) {
        score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = node;
      }
    }

    logger.info("直播入口候选筛选完成", {
      total: nodes.length,
      selected: !!best,
      bestScore: bestScore,
      samples: samples
    });
    return best;
  }

  function isLiveEntryBoundsAllowed(bounds, screen) {
    if (!bounds || !screen) {
      return false;
    }
    var centerX = bounds.centerX();
    var centerY = bounds.centerY();
    if (bounds.width && bounds.width() <= 0) {
      return false;
    }
    if (bounds.height && bounds.height() <= 0) {
      return false;
    }
    if (centerX < screen.width * 0.04 || centerX > screen.width * 0.96) {
      return false;
    }
    if (centerY < screen.height * 0.10 || centerY > screen.height * 0.82) {
      return false;
    }
    return true;
  }

  function tryLiveEntryFallback(visibleTextHint) {
    var visibleText = visibleTextHint || extractVisibleText();
    if (!/进入直播间|点击进入直播间|正在直播|直播中|主播|讲解中|热聊中|直播[，,\s]*按钮/.test(visibleText)) {
      return false;
    }

    var screen = autojsUtils.getScreenSize();
    var points = [
      { x: screen.width * 0.50, y: screen.height * 0.20, name: "top_center" },
      { x: screen.width * 0.50, y: screen.height * 0.28, name: "upper_card" },
      { x: screen.width * 0.68, y: screen.height * 0.28, name: "upper_right" },
      { x: screen.width * 0.50, y: screen.height * 0.36, name: "card_center" },
      { x: screen.width * 0.50, y: screen.height * 0.42, name: "center_upper" },
      { x: screen.width * 0.70, y: screen.height * 0.42, name: "right_upper" }
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
    return screenRecognizer.isLiveRoomVisible(recognitionOptions());
  }

  function exitLiveRoom() {
    logger.info("退出直播间");
    back();
    autojsUtils.sleepRandom(1200, 2000);
  }

  function extractVisibleText() {
    return screenRecognizer.extractVisibleText();
  }

  function extractScreen() {
    return screenRecognizer.extractScreen(null, recognitionOptions());
  }

  function extractFastText() {
    return screenRecognizer.extractFastText(recognitionOptions());
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
      var descNodes = descMatches(".*评论.*").find();
      for (var i = 0; i < descNodes.length; i++) {
        nodes.push(descNodes[i]);
      }
    } catch (error) {
    }
    try {
      var textNodes = textMatches(".*评论.*").find();
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
      textMatches(".*评论.*").findOne(500) ||
      descMatches(".*评论.*").findOne(500) ||
      textMatches("说点什么|抢首评|全部评论|暂无评论").findOne(500)
    );
  }

  function requiresConfiguredLiveReply(options) {
    options = options || {};
    if (options.allowUnconfiguredReply === true) {
      return false;
    }
    var commentMode = options.commentMode || config.task.liveCommentMode || "";
    return commentMode !== "agri_chatbot";
  }

  function isConfiguredLiveReply(replyText) {
    var liveComment = config.task.liveComment || {};
    var replyPools = liveComment.replyPools || {};
    var groups = ["A", "B", "C"];
    for (var i = 0; i < groups.length; i++) {
      var pool = replyPools[groups[i]] || [];
      for (var j = 0; j < pool.length; j++) {
        if (String(pool[j]) === String(replyText)) {
          return true;
        }
      }
    }
    return false;
  }

  function findLiveCommentInput() {
    var selectors = [
      textMatches("说点什么|发条评论|期待你的评论"),
      descMatches("说点什么|发条评论|期待你的评论"),
      className("android.widget.EditText")
    ];
    for (var i = 0; i < selectors.length; i++) {
      try {
        var node = selectors[i].findOne(800);
        if (node) {
          return node;
        }
      } catch (error) {
      }
    }
    return null;
  }

  function findLiveCommentSendButton() {
    var selectors = [
      textMatches("^发送$|^发布$"),
      descMatches("^发送$|^发布$")
    ];
    for (var i = 0; i < selectors.length; i++) {
      try {
        var node = selectors[i].findOne(800);
        if (node) {
          return node;
        }
      } catch (error) {
      }
    }
    return null;
  }

  function sendLiveComment(replyText, options) {
    options = options || {};
    replyText = String(replyText || "").trim();
    if (!replyText) {
      return { success: false, failureReason: "empty_reply_text" };
    }
    if (requiresConfiguredLiveReply(options) && !isConfiguredLiveReply(replyText)) {
      return { success: false, failureReason: "reply_not_configured" };
    }
    if (!ensureDouyinForeground()) {
      return { success: false, failureReason: "douyin_not_foreground" };
    }
    if (!isLiveRoomVisible()) {
      return { success: false, failureReason: "live_room_not_visible" };
    }
    if (options.plannedDelayMs) {
      sleep(Number(options.plannedDelayMs));
    }
    if (!ensureDouyinForeground()) {
      return { success: false, failureReason: "douyin_not_foreground_after_delay" };
    }
    if (!isLiveRoomVisible()) {
      return { success: false, failureReason: "live_room_not_visible_after_delay" };
    }

    avoidFloaty("live_comment_send");
    var inputNode = findLiveCommentInput();
    if (!inputNode) {
      return { success: false, failureReason: "comment_input_not_found" };
    }
    if (!autojsUtils.safeClick(inputNode, 3, logger)) {
      return { success: false, failureReason: "comment_input_click_failed" };
    }
    autojsUtils.sleepRandom(500, 900);
    try {
      setText(replyText);
    } catch (error) {
      return { success: false, failureReason: "set_text_failed:" + String(error) };
    }
    autojsUtils.sleepRandom(300, 700);

    var sendButton = findLiveCommentSendButton();
    if (!sendButton) {
      return { success: false, failureReason: "send_button_not_found" };
    }
    if (!autojsUtils.safeClick(sendButton, 3, logger)) {
      return { success: false, failureReason: "send_button_click_failed" };
    }
    autojsUtils.sleepRandom(800, 1400);
    return {
      success: true,
      failureReason: "",
      sentAt: new Date().toISOString()
    };
  }

  function likeCurrentLiveRoom(options) {
    options = options || {};
    if (!ensureDouyinForeground()) {
      return { success: false, failureReason: "douyin_not_foreground" };
    }
    if (!isLiveRoomVisible()) {
      return { success: false, failureReason: "live_room_not_visible" };
    }
    var maxLikes = Math.max(1, Math.min(Number(options.maxLikes || options.maxLikesPerLiveRoom || 1), 3));
    avoidFloaty("p3_live_like");
    var screen = autojsUtils.getScreenSize();
    for (var i = 0; i < maxLikes; i++) {
      autojsUtils.clickPoint(Math.floor(screen.width * 0.88), Math.floor(screen.height * 0.62), logger, "p3_live_like");
      autojsUtils.sleepRandom(900, 1600);
    }
    return {
      success: true,
      failureReason: "",
      likedCount: maxLikes
    };
  }

  function followAuthorizedAccount(options) {
    options = options || {};
    if (!ensureDouyinForeground()) {
      return { success: false, failureReason: "douyin_not_foreground" };
    }
    if (!isLiveRoomVisible()) {
      return { success: false, failureReason: "live_room_not_visible" };
    }
    var targetName = String(options.targetAccountName || "").trim();
    var visibleText = extractVisibleText();
    if (targetName && visibleText.indexOf(targetName) < 0) {
      return { success: false, failureReason: "target_account_not_visible" };
    }
    var followNode =
      autojsUtils.waitForElement(textMatches("^(关注|关注主播|\\+)$"), 800, null, logger) ||
      autojsUtils.waitForElement(descMatches("^(关注|关注主播|\\+)$"), 800, null, logger);
    if (!followNode) {
      return { success: false, failureReason: "follow_button_not_found" };
    }
    avoidFloaty("p3_authorized_follow");
    if (!autojsUtils.safeClick(followNode, 3, logger)) {
      return { success: false, failureReason: "follow_button_click_failed" };
    }
    autojsUtils.sleepRandom(1200, 1800);
    return {
      success: true,
      failureReason: "",
      targetAccountName: targetName
    };
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
    if (!isForeground()) {
      logger.warn("Douyin is not foreground, reopen before recovery", {
        sceneType: sceneType || "",
        actualPackage: currentPackage()
      });
      if (sceneType !== "live" && shouldRecoverSearchContext(sceneType || "recover")) {
        restartSearchContext("recover_foreground");
        return;
      }
      restartToFeed();
      return;
    }
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

  function exitAppToHome(reason) {
    logger.info("任务收尾：退出抖音回到手机桌面", {
      reason: reason || "",
      activity: safeCurrentActivity()
    });
    try {
      home();
      autojsUtils.sleepRandom(800, 1200);
      return true;
    } catch (error) {
      logger.warn("任务收尾：退出抖音失败", {
        reason: reason || "",
        message: String(error)
      });
      return false;
    }
  }

  return {
    isForeground: isForeground,
    openApp: openApp,
    openSearch: openSearch,
    openLiveSearch: openLiveSearch,
    enterMall: enterMall,
    openCommerceCardSearch: openCommerceCardSearch,
    browseCommerceCards: browseCommerceCards,
    openMatchingCommerceLiveFromCards: openMatchingCommerceLiveFromCards,
    openTargetLiveRoomFromLiveFeed: openTargetLiveRoomFromLiveFeed,
    openTargetLiveRoomFromSearch: openTargetLiveRoomFromSearch,
    getLastTargetLiveSearchResult: getLastTargetLiveSearchResult,
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
    sendLiveComment: sendLiveComment,
    likeCurrentLiveRoom: likeCurrentLiveRoom,
    followAuthorizedAccount: followAuthorizedAccount,
    openComments: openComments,
    extractHotComments: extractHotComments,
    closeComments: closeComments,
    nextVideo: nextVideo,
    recover: recover,
    restartSearchContext: restartSearchContext,
    restartToLiveFeed: restartToLiveFeed,
    refreshLiveFeedFromHome: refreshLiveFeedFromHome,
    restartToFeed: restartToFeed,
    exitAppToHome: exitAppToHome
  };
}

module.exports = {
  createDouyinAdapter: createDouyinAdapter
};
