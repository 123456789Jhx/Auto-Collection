function createDouyinCommerceCardBrowser(context) {
  var logger = context.logger;
  var autojsUtils = context.autojsUtils;
  var detector = context.commerceCardDetector;
  var signature = context.commerceCardSignature;

  function extractVisibleText() {
    return context.extractVisibleText();
  }

  function clickCommerceResultTabIfVisible() {
    var tabNode =
      autojsUtils.waitForElement(textMatches("^全部$"), 600, null, null) ||
      autojsUtils.waitForElement(descMatches("^全部$"), 600, null, null);
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

  function tryReuseCommerceCardSearchResult(keyword, source) {
    var visibleText = extractVisibleText();
    if (!context.isSearchResultForKeyword(keyword, visibleText)) {
      return false;
    }
    if (!context.isCommerceSearchOrDetailText(visibleText)) {
      clickCommerceResultTabIfVisible();
      visibleText = extractVisibleText();
    }
    if (!context.isCommerceSearchOrDetailText(visibleText)) {
      return false;
    }
    context.setActiveSearchKeyword(keyword || "");
    logger.info("reuse current commerce card search result", {
      keyword: keyword,
      source: source || "",
      textSample: visibleText.slice(0, 180)
    });
    return true;
  }

  function openCommerceCardSearch(keyword) {
    keyword = String(keyword || "").replace(/\s+/g, " ").trim();
    if (!keyword) {
      return false;
    }
    if (tryReuseCommerceCardSearchResult(keyword, "before_enter_mall")) {
      return true;
    }
    if (!context.enterMall()) {
      if (tryReuseCommerceCardSearchResult(keyword, "after_enter_mall_failed")) {
        return true;
      }
      return false;
    }
    if (!context.openSearch(keyword)) {
      logger.warn("商城商品卡搜索失败", {
        keyword: keyword,
        reason: context.getLastSearchFailureReason() || "",
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

  function recoverCommerceCardSearch(searchKeyword, reason, textSample) {
    logger.warn("商品卡浏览上下文偏离，重新进入商城搜索", {
      reason: reason || "",
      searchKeyword: searchKeyword || "",
      textSample: String(textSample || "").slice(0, 180)
    });
    if (context.isSearchResultPageText(textSample) && clickCommerceResultTabIfVisible()) {
      return true;
    }
    return openCommerceCardSearch(searchKeyword);
  }

  function isCommerceProductCandidateNode(node) {
    if (!node) {
      return false;
    }
    var ownText = context.getNodeOwnText(node);
    var contextText = context.collectNodeContextText(node, 2);
    var combinedText = [ownText, contextText].join("\n");
    if (detector.isNonProductCardText(ownText) || detector.isNonProductCardText(contextText)) {
      return false;
    }
    return detector.isProductSignalText(ownText) || detector.isProductSignalText(combinedText);
  }

  function isCommerceSearchCardBoundsAllowed(bounds, screen) {
    if (!bounds || !context.isTargetSearchBoundsAllowed(bounds, screen)) {
      return false;
    }
    if (bounds.width && bounds.width() > screen.width * 0.98) {
      return false;
    }
    if (bounds.height && bounds.height() > screen.height * 0.50) {
      return false;
    }
    return true;
  }

  function findCommerceKeywordProductCardCandidate(keywordNode, keywordRegex, screen) {
    var best = null;
    var bestScore = -1;
    var matchedText = context.getNodeOwnText(keywordNode);
    var current = keywordNode;
    for (var depth = 0; current && depth <= 4; depth++) {
      var bounds = current.bounds && current.bounds();
      if (bounds && isCommerceSearchCardBoundsAllowed(bounds, screen)) {
        var ownText = context.getNodeOwnText(current);
        var contextText = context.collectNodeContextText(current, 1);
        var combinedText = [ownText, contextText, matchedText].join("\n");
        if (keywordRegex.test(combinedText) &&
          !detector.isNonProductCardText(ownText) &&
          (detector.isProductSignalText(combinedText) || detector.isProductTitleLikeText(combinedText))) {
          var score = detector.scoreProductCardCandidate(bounds, screen, combinedText, depth, false);
          if (current.clickable && current.clickable()) {
            score += 2;
          }
          if (score > bestScore) {
            bestScore = score;
            best = {
              node: current,
              score: score,
              bounds: autojsUtils.formatBounds(bounds),
              text: combinedText,
              matchedText: matchedText
            };
          }
        }
      }
      try {
        current = current.parent && current.parent();
      } catch (error) {
        current = null;
      }
    }
    return best;
  }

  function findCommerceRelatedProductCardCandidate(keywordNode, keywordRegex, skippedBounds, screen) {
    var best = null;
    var bestScore = -1;
    var matchedText = context.getNodeOwnText(keywordNode);
    var relatedZoneVisible = detector.isRelatedZoneText(extractVisibleText());
    var current = keywordNode;
    for (var depth = 0; current && depth <= 4; depth++) {
      var bounds = current.bounds && current.bounds();
      var boundsKey = autojsUtils.formatBounds(bounds);
      if (bounds && !skippedBounds[boundsKey] && detector.isRelatedCardBoundsAllowed(bounds, screen)) {
        var ownText = context.getNodeOwnText(current);
        var contextText = context.collectNodeContextText(current, 1);
        var combinedText = [ownText, contextText, matchedText].join("\n");
        if (keywordRegex.test(combinedText) &&
          !/进店逛逛|客服|加购物车|领券购买|立即购买|专享价/.test(combinedText) &&
          !detector.isNonProductCardText(ownText) &&
          (detector.isProductSignalText(combinedText) || detector.isRelatedZoneText(combinedText) || (relatedZoneVisible && detector.isProductTitleLikeText(combinedText)))) {
          var score = detector.scoreProductCardCandidate(bounds, screen, combinedText, depth, relatedZoneVisible);
          if (current.clickable && current.clickable()) {
            score += 2;
          }
          if (score > bestScore) {
            bestScore = score;
            best = {
              node: current,
              score: score,
              bounds: boundsKey,
              text: combinedText,
              matchedText: matchedText
            };
          }
        }
      }
      try {
        current = current.parent && current.parent();
      } catch (error) {
        current = null;
      }
    }
    return best;
  }

  function clickCommerceKeywordCard(matchKeywords) {
    var keywordRegex = context.buildContainsRegex(matchKeywords);
    if (!keywordRegex) {
      return false;
    }
    var nodes = [];
    context.pushFoundNodes(nodes, textMatches(keywordRegex));
    context.pushFoundNodes(nodes, descMatches(keywordRegex));
    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node) {
        continue;
      }
      var candidate = findCommerceKeywordProductCardCandidate(node, keywordRegex, screen);
      if (!candidate && isCommerceProductCandidateNode(node)) {
        var bounds = node.bounds && node.bounds();
        if (bounds && isCommerceSearchCardBoundsAllowed(bounds, screen)) {
          var value = String((node.text && node.text()) || (node.desc && node.desc()) || "");
          candidate = {
            node: node,
            score: 10,
            bounds: autojsUtils.formatBounds(bounds),
            text: value,
            matchedText: value
          };
        }
      }
      if (candidate && candidate.score > bestScore) {
        bestScore = candidate.score;
        best = candidate;
      }
    }
    if (!best) {
      return false;
    }
    logger.info("点击命中关键词的商品卡片区域", {
      bounds: best.bounds,
      text: String(best.text || "").slice(0, 160),
      matchedText: String(best.matchedText || "").slice(0, 80)
    });
    autojsUtils.axisClick(best.node, logger);
    autojsUtils.sleepRandom(1800, 2600);
    return true;
  }

  function clickCommerceRelatedProductCard(matchKeywords, skippedBounds) {
    var keywordRegex = context.buildContainsRegex(matchKeywords);
    if (!keywordRegex) {
      return null;
    }
    skippedBounds = skippedBounds || {};
    var nodes = [];
    context.pushFoundNodes(nodes, textMatches(keywordRegex));
    context.pushFoundNodes(nodes, descMatches(keywordRegex));
    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node) {
        continue;
      }
      var value = String((node.text && node.text()) || (node.desc && node.desc()) || "");
      if (/进店逛逛|客服|加购物车|领券购买|立即购买|专享价/.test(value)) {
        continue;
      }
      var candidate = findCommerceRelatedProductCardCandidate(node, keywordRegex, skippedBounds, screen);
      if (!candidate && isCommerceProductCandidateNode(node)) {
        var bounds = node.bounds && node.bounds();
        var boundsKey = autojsUtils.formatBounds(bounds);
        if (bounds && !skippedBounds[boundsKey] && detector.isRelatedCardBoundsAllowed(bounds, screen)) {
          candidate = {
            node: node,
            score: 10,
            bounds: boundsKey,
            text: value,
            matchedText: value
          };
        }
      }
      if (candidate && candidate.score > bestScore) {
        bestScore = candidate.score;
        best = candidate;
      }
    }
    if (!best) {
      return null;
    }
    logger.info("点击详情页后续商品卡片区域", {
      bounds: best.bounds,
      text: String(best.text || "").slice(0, 160),
      matchedText: String(best.matchedText || "").slice(0, 80)
    });
    autojsUtils.axisClick(best.node, logger);
    autojsUtils.sleepRandom(1800, 2600);
    return {
      clicked: true,
      bounds: best.bounds,
      text: best.text,
      desc: best.matchedText
    };
  }

  function findCommerceLiveEntryNode(liveSignals) {
    var signalRegex = context.buildContainsRegex(liveSignals);
    if (!signalRegex) {
      return null;
    }
    var nodes = [];
    context.pushFoundNodes(nodes, textMatches(signalRegex));
    context.pushFoundNodes(nodes, descMatches(signalRegex));
    var screen = autojsUtils.getScreenSize();
    var best = null;
    var bestScore = -1;
    var samples = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var bounds = node && node.bounds && node.bounds();
      if (!bounds || !context.isLiveEntryBoundsAllowed(bounds, screen)) {
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

  function openCommerceLiveFromCurrentScreen(matchKeywords, liveSignals, targetRoom) {
    var entryNode = findCommerceLiveEntryNode(liveSignals);
    if (entryNode) {
      autojsUtils.axisClick(entryNode, logger);
      autojsUtils.sleepRandom(2500, 4000);
      if (context.isLiveRoomVisible()) {
        return true;
      }
      logger.warn("点击商品卡直播入口后未进入直播间", {
        textSample: extractVisibleText().slice(0, 180)
      });
      context.back();
      autojsUtils.sleepRandom(700, 1100);
      return false;
    }
    if (context.openLiveRoomFromCurrentScreen(extractVisibleText())) {
      return true;
    }
    if (!clickCommerceKeywordCard(matchKeywords)) {
      return false;
    }
    var detailText = extractVisibleText();
    if (!context.hasTargetTextMatch(detailText, matchKeywords, targetRoom) || !context.hasAnyTextKeyword(detailText, liveSignals)) {
      logger.info("商品详情页未同时命中商品关键词和直播信号", {
        textSample: detailText.slice(0, 180)
      });
      context.back();
      autojsUtils.sleepRandom(700, 1100);
      return false;
    }
    entryNode = findCommerceLiveEntryNode(liveSignals);
    if (!entryNode) {
      context.back();
      autojsUtils.sleepRandom(700, 1100);
      return false;
    }
    autojsUtils.axisClick(entryNode, logger);
    autojsUtils.sleepRandom(2500, 4000);
    if (context.isLiveRoomVisible()) {
      return true;
    }
    context.back();
    autojsUtils.sleepRandom(700, 1100);
    return false;
  }

  function confirmCommerceLiveRoom(matchKeywords, targetRoom) {
    if (!context.isLiveRoomVisible()) {
      return false;
    }
    var visibleText = extractVisibleText();
    if (context.hasTargetTextMatch(visibleText, matchKeywords, targetRoom)) {
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
        reason: context.getLastSearchFailureReason() || "commerce_search_failed",
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
      var keywordMatched = context.hasTargetTextMatch(visibleText, matchKeywords, targetRoom);
      var liveMatched = context.hasAnyTextKeyword(visibleText, liveSignals);
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
        context.back();
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
      context.swipeSearchResultsUp();
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
    var requireFullScan = options.requireFullScan === true;
    var skipLiveCards = options.skipLiveCards === true;
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
    function browseOpenedCommerceDetail(attempt, hardEndAt, remainingCards, stayUntilHardEnd) {
      var detailStartedAt = Date.now();
      var detailEndAt = Math.min(hardEndAt, detailStartedAt + dwellSeconds * 1000);
      var detailBrowsedCount = 1;
      var openedLive = false;
      var nextSwipeAt = detailStartedAt + 15000;
      var extendedSearchLogged = false;
      var skippedRelatedBounds = {};
      var sample = "";
      while (Date.now() < hardEndAt && (stayUntilHardEnd || detailBrowsedCount < remainingCards)) {
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
        if (!skipLiveCards && !openedLive && context.hasAnyTextKeyword(detailText, liveSignals) && openCommerceLiveFromCurrentScreen(matchKeywords, liveSignals, targetRoom)) {
          openedLive = true;
          var liveWatchMs = Math.min(liveWatchSeconds * 1000, Math.max(0, Math.min(detailEndAt, hardEndAt) - Date.now()));
          if (liveWatchMs > 0 && !sleepInterruptible(liveWatchMs, "commerce_detail_live_watch_" + attempt)) {
            return {
              success: false,
              reason: "manual_pause",
              browsedCount: detailBrowsedCount,
              textSample: sample
            };
          }
          if (context.isLiveRoomVisible()) {
            context.exitLiveRoom();
          } else {
            context.back();
            autojsUtils.sleepRandom(700, 1100);
          }
        }
        if ((stayUntilHardEnd || detailBrowsedCount < remainingCards) &&
          Date.now() - detailStartedAt >= Math.min(15000, Math.floor(dwellSeconds * 300)) &&
          Date.now() + 15000 < hardEndAt &&
          detector.isRelatedProductListText(
            detailText,
            context.hasTargetTextMatch(detailText, matchKeywords, targetRoom),
            context.hasAnyTextKeyword(detailText, recommendationSignals)
          )) {
          var beforeRelatedSignature = signature.buildDetailSignature(detailText);
          var relatedClick = clickCommerceRelatedProductCard(matchKeywords, skippedRelatedBounds);
          if (relatedClick && relatedClick.clicked) {
            var afterRelatedText = extractVisibleText();
            var afterRelatedSignature = signature.buildDetailSignature(afterRelatedText);
            if (afterRelatedSignature !== beforeRelatedSignature &&
              context.hasTargetTextMatch(afterRelatedText, matchKeywords, targetRoom) &&
              context.isCommerceSearchOrDetailText(afterRelatedText)) {
              detailBrowsedCount += 1;
              detailStartedAt = Date.now();
              detailEndAt = Math.min(hardEndAt, detailStartedAt + dwellSeconds * 1000);
              nextSwipeAt = detailStartedAt + 15000;
              extendedSearchLogged = false;
              skippedRelatedBounds = {};
              openedLive = false;
              continue;
            }
            if (relatedClick.bounds) {
              skippedRelatedBounds[relatedClick.bounds] = true;
            }
            logger.warn("commerce related product click did not open a new product, skip this bounds and continue swiping", {
              attempt: attempt,
              bounds: relatedClick.bounds || "",
              text: String(relatedClick.text || relatedClick.desc || "").slice(0, 80),
              textSample: afterRelatedText.slice(0, 180)
            });
            nextSwipeAt = Date.now();
            continue;
          }
        }
        if (Date.now() >= detailEndAt && Date.now() + 1200 < hardEndAt) {
          if (!extendedSearchLogged) {
            logger.info("商品详情页未点到后续商品卡，继续在详情页下滑查找", {
              attempt: attempt,
              browsedCount: detailBrowsedCount,
              targetCount: remainingCards,
              textSample: sample
            });
            extendedSearchLogged = true;
          }
          detailEndAt = Math.min(hardEndAt, Date.now() + 15000);
        }
        if (Date.now() >= nextSwipeAt && Date.now() + 1200 < hardEndAt) {
          context.swipeSearchResultsUp();
          nextSwipeAt = Date.now() + 15000;
          continue;
        }
        if (!sleepInterruptible(Math.min(1000, hardEndAt - Date.now()), "commerce_detail_wait_" + attempt)) {
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
        reason: context.getLastSearchFailureReason() || "commerce_search_failed",
        elapsedMs: Date.now() - startedAt
      };
    }
    var endAt = Date.now() + scanMinutes * 60 * 1000;
    var attempt = 0;
    var browsedCount = 0;
    var lastTextSample = "";
    while (Date.now() < endAt && (requireFullScan || browsedCount < cardCount)) {
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
      if (context.isCommerceVideoDriftText(visibleText) || !context.isCommerceSearchOrDetailText(visibleText)) {
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
            reason: context.getLastSearchFailureReason() || "commerce_context_recover_failed",
            elapsedMs: Date.now() - startedAt,
            attempt: attempt,
            browsedCount: browsedCount,
            textSample: lastTextSample
          };
        }
        visibleText = extractVisibleText();
        lastTextSample = visibleText.slice(0, 220);
      }
      var keywordMatched = context.hasTargetTextMatch(visibleText, matchKeywords, targetRoom);
      var openedDetailThisAttempt = false;
      logger.info("commerce card browsing page", {
        attempt: attempt,
        browsedCount: browsedCount,
        targetCount: cardCount,
        keywordMatched: keywordMatched,
        textSample: visibleText.slice(0, 180)
      });
      if (keywordMatched && clickCommerceKeywordCard(matchKeywords)) {
        var remainingCards = requireFullScan ? Math.max(1, cardCount - browsedCount) : cardCount - browsedCount;
        openedDetailThisAttempt = true;
        var detailResult = browseOpenedCommerceDetail(attempt, endAt, remainingCards, requireFullScan);
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
      if (!openedDetailThisAttempt && (requireFullScan || browsedCount < cardCount)) {
        context.swipeSearchResultsUp();
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

  return {
    openCommerceCardSearch: openCommerceCardSearch,
    browseCommerceCards: browseCommerceCards,
    openMatchingCommerceLiveFromCards: openMatchingCommerceLiveFromCards
  };
}

module.exports = {
  createDouyinCommerceCardBrowser: createDouyinCommerceCardBrowser
};
