// 职责：按关键词搜索并停留在经过稳定区域文本验证的目标直播间。
var postPublishCleanupModule = require("../publish-video/douyin-post-publish-cleanup.js");
function createTargetLiveEntryTask(options) {
  options = options || {};
  var context = options.context || {};
  var logger = options.logger || context.logger || { info: function () {}, warn: function () {} };
  var runtime = options.runtime || createRuntime(context, logger, options.fastSearch);
  var interactionRunner = options.interactionRunner;
  var sessionRunner = options.sessionRunner;
  var finalCleanup = options.finalCleanup;

  function stopped(control) {
    return !!(control && control.shouldStop && control.shouldStop());
  }

  function normalizedTerms(payload) {
    var terms = [];
    var related = payload.relatedTerms || [];
    for (var i = 0; i < related.length; i++) {
      var term = String(related[i] || "").trim();
      if (term && terms.indexOf(term) < 0) terms.push(term);
    }
    return terms.filter(Boolean);
  }

  function matchEvidence(evidence, terms) {
    evidence = evidence || {};
    var sources = [{ method: "ocr", text: String(evidence.ocrText || "") }];
    for (var sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      for (var termIndex = 0; termIndex < terms.length; termIndex++) {
        if (sources[sourceIndex].text.indexOf(terms[termIndex]) >= 0) {
          return { matched: true, matchedTerm: terms[termIndex], matchMethod: sources[sourceIndex].method };
        }
      }
    }
    return { matched: false, matchedTerm: "", matchMethod: "" };
  }

  function run(payload, control) {
    payload = payload || {};
    var terms = normalizedTerms(payload);
    var maxRounds = Number(payload.maxRounds || 3);
    var candidatesPerRound = Number(payload.candidatesPerRound || 4);
    var attempts = 0;
    var lastError = "";
    if (stopped(control)) return { status: "STOPPED", attempts: 0 };

    for (var round = 0; round < maxRounds; round++) {
      try {
        if (!runtime.openDouyin()) throw new Error("DOUYIN_OPEN_FAILED");
        // 打开抖音后的等待区间取自设备画像（不同机型冷启动耗时差异很大）。
        var openWait = typeof runtime.openDouyinWaitRange === "function"
          ? runtime.openDouyinWaitRange()
          : [5000, 7000];
        runtime.waitRandom(openWait[0], openWait[1]);
        if (stopped(control)) return { status: "STOPPED", attempts: attempts };
        var searchResult = runtime.openSearch(payload.targetKeyword, control);
        if (searchResult && searchResult.stopped) return { status: "STOPPED", attempts: attempts };
        if (searchResult === false || (searchResult && searchResult.success === false)) {
          throw new Error("SEARCH_OPEN_FAILED:" + String(searchResult && searchResult.stage || "unknown"));
        }
        if (!runtime.openLiveTab()) throw new Error("LIVE_TAB_NOT_FOUND");
        runtime.waitRandom(3000, 3000);
        if (!runtime.openFirstLive()) throw new Error("LIVE_ENTRY_NOT_FOUND");
        runtime.waitRandom(1000, 3000);

        for (var candidate = 0; candidate < candidatesPerRound; candidate++) {
          if (stopped(control)) return { status: "STOPPED", attempts: attempts };
          attempts += 1;
          if (!runtime.isLiveRoom()) throw new Error("LIVE_ROOM_NOT_READY");
          var evidence = runtime.readStableEvidence();
          var match = matchEvidence(evidence, terms);
          if (evidence && evidence.commerceCartVisible) {
            lastError = "COMMERCE_CART_DETECTED";
            logger.info("识别到小黄车，跳过当前直播间", {
              round: round + 1,
              candidate: candidate + 1,
              matchedTerm: match.matched ? match.matchedTerm : ""
            });
          } else if (match.matched) {
            logger.info("目标直播间已进入", {
              batchId: payload.batchId || "",
              targetKeyword: payload.targetKeyword || "",
              matchedTerm: match.matchedTerm,
              matchMethod: match.matchMethod,
              round: round + 1,
              candidate: candidate + 1
            });
            var sessionControl = {
              validateCurrentLive: function () {
                var currentEvidence = runtime.readStableEvidence();
                var currentMatch = matchEvidence(currentEvidence, terms);
                if (currentEvidence && currentEvidence.commerceCartVisible) {
                  logger.info("新直播间识别到小黄车，继续筛选", {
                    matchedTerm: currentMatch.matched ? currentMatch.matchedTerm : ""
                  });
                  return { matched: false, reason: "COMMERCE_CART_DETECTED" };
                }
                if (!currentMatch.matched) {
                  logger.info("新直播间相关名词未命中，继续筛选", {});
                  return { matched: false, reason: "RELATED_TERM_NOT_MATCHED" };
                }
                logger.info("新直播间相关名词校验通过", {
                  matchedTerm: currentMatch.matchedTerm,
                  matchMethod: currentMatch.matchMethod
                });
                return {
                  matched: true,
                  matchedTerm: currentMatch.matchedTerm,
                  matchMethod: currentMatch.matchMethod
                };
              }
            };
            var interactionResult = sessionRunner
              ? sessionRunner.run(payload, control, sessionControl)
              : interactionRunner
                ? interactionRunner.run(payload, control)
                : { status: "COMPLETED", likes: { completed: 0 }, comments: { sentComments: [] } };
            if (interactionResult.status !== "COMPLETED") {
              return {
                status: interactionResult.status,
                attempts: attempts,
                interaction: interactionResult
              };
            }
            var cleanupResult = null;
            if (sessionRunner && finalCleanup) {
              try {
                cleanupResult = finalCleanup.run({ taskId: String(payload.batchId || payload.taskId || "") });
              } catch (cleanupError) {
                return { status: "WARMUP_FINAL_CLEANUP_FAILED", attempts: attempts, message: String(cleanupError) };
              }
              if (!cleanupResult || !cleanupResult.completed) {
                return { status: "WARMUP_FINAL_CLEANUP_FAILED", attempts: attempts, cleanup: cleanupResult || null };
              }
            }
            return {
              status: "TARGET_LIVE_ENTERED",
              matchedTerm: match.matchedTerm,
              matchMethod: match.matchMethod,
              attempts: attempts,
              round: round + 1,
              candidate: candidate + 1,
              likes: interactionResult.likes || interactionResult.lastInteraction && interactionResult.lastInteraction.likes,
              comments: interactionResult.comments || interactionResult.lastInteraction && interactionResult.lastInteraction.comments,
              completedLiveCount: interactionResult.completedLiveCount,
              cleanup: cleanupResult
            };
          } else {
            lastError = "RELATED_TERM_NOT_MATCHED";
            logger.info("直播间相关名词未命中，切换下一直播间", {
              round: round + 1,
              candidate: candidate + 1
            });
          }
          if (candidate < candidatesPerRound - 1) {
            if (!runtime.nextLive()) throw new Error("NEXT_LIVE_FAILED");
            runtime.waitRandom(1000, 3000);
          }
        }
      } catch (error) {
        lastError = String(error && error.message || error);
        logger.warn("目标直播间候选检查失败", {
          round: round + 1,
          message: lastError
        });
      }
      runtime.recover();
      runtime.waitRandom(1000, 3000);
    }
    return {
      status: "TARGET_LIVE_NOT_FOUND",
      message: "连续3轮未找到目标直播间",
      attempts: attempts,
      lastError: lastError
    };
  }

  return { run: run, matchEvidence: matchEvidence };
}

function createRuntime(context, logger, fastSearch) {
  var douyin = context.douyin || {};
  var ocrEngine = context.ocrEngine || {};

  function waitRandom(min, max) {
    if (typeof sleep !== "function") return;
    sleep(Math.floor(min + Math.random() * (max - min + 1)));
  }

  // 打开抖音后的等待区间取自设备画像（不同机型冷启动耗时差异很大）。
  // 画像不可用或取值非法时回退到历史默认值。
  var DEFAULT_OPEN_DOUYIN_WAIT_MS = [5000, 7000];

  function openDouyinWaitRange() {
    var profile = context.deviceProfile;
    var helper = context.deviceProfiles;
    if (!profile || !helper || typeof helper.pickWaitRange !== "function") {
      return DEFAULT_OPEN_DOUYIN_WAIT_MS.slice();
    }
    try {
      return helper.pickWaitRange(profile.values && profile.values.openDouyinWaitMs, DEFAULT_OPEN_DOUYIN_WAIT_MS);
    } catch (error) {
      return DEFAULT_OPEN_DOUYIN_WAIT_MS.slice();
    }
  }


  function screenSize() {
    return {
      width: Math.max(1, Number(typeof device !== "undefined" && device.width || 1080)),
      height: Math.max(1, Number(typeof device !== "undefined" && device.height || 2400))
    };
  }

  function clickableNode(node) {
    var target = node;
    for (var i = 0; i < 5 && target; i++) {
      try { if (target.clickable && target.clickable()) return target; } catch (error) {}
      try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
    }
    return node;
  }

  function appendFoundNodes(target, selector) {
    try {
      var found = selector.find();
      var count = typeof found.length === "number" ? found.length : found.size ? found.size() : 0;
      for (var i = 0; i < count; i++) {
        target.push(typeof found.get === "function" ? found.get(i) : found[i]);
      }
    } catch (error) {}
  }

  function openLiveTab() {
    var nodes = [];
    try { appendFoundNodes(nodes, text("直播")); } catch (error) {}
    try { appendFoundNodes(nodes, desc("直播")); } catch (error2) {}
    var size = screenSize();
    for (var i = 0; i < nodes.length; i++) {
      var bounds = nodes[i] && nodes[i].bounds && nodes[i].bounds();
      if (!bounds || bounds.centerY() > size.height * 0.38) continue;
      var target = clickableNode(nodes[i]);
      try { if (target && target.click && target.click()) return true; } catch (clickError) {}
      if (typeof click === "function" && click(bounds.centerX(), bounds.centerY())) return true;
    }
    return false;
  }

  function advanceCandidate(index) {
    if (!index) return true;
    if (typeof swipe !== "function") return false;
    var size = screenSize();
    for (var i = 0; i < index; i++) {
      swipe(size.width * 0.5, size.height * 0.76, size.width * 0.5, size.height * 0.30, 520);
      waitRandom(1000, 3000);
    }
    return true;
  }

  function filterStableText(value) {
    return String(value || "").split(/\n+/).filter(function (line) {
      return line && !/说点什么|评论|购买|商品|购物车|¥|￥/.test(line);
    }).join("\n");
  }

  function collectTopText() {
    var values = [];
    var size = screenSize();
    var selectors = [];
    try { selectors.push(textMatches(".+")); } catch (error) {}
    try { selectors.push(descMatches(".+")); } catch (error2) {}
    for (var s = 0; s < selectors.length; s++) {
      try {
        var nodes = selectors[s].find();
        var count = typeof nodes.length === "number" ? nodes.length : nodes.size ? nodes.size() : 0;
        for (var i = 0; i < count; i++) {
          var node = typeof nodes.get === "function" ? nodes.get(i) : nodes[i];
          var bounds = node && node.bounds && node.bounds();
          if (!bounds || bounds.centerY() > size.height * 0.45) continue;
          var value = String(node.text && node.text() || node.desc && node.desc() || "").trim();
          if (value && values.indexOf(value) < 0) values.push(value);
        }
      } catch (findError) {}
    }
    return filterStableText(values.join("\n"));
  }

  function readStableEvidence() {
    var size = screenSize();
    var ocrText = "";
    var commerceCartVisible = false;
    if (ocrEngine.captureRegions) {
      var result = ocrEngine.captureRegions({
        roomName: { x: 0, y: Math.floor(size.height * 0.03), w: size.width, h: Math.floor(size.height * 0.17) },
        roomContent: { x: 0, y: Math.floor(size.height * 0.16), w: size.width, h: Math.floor(size.height * 0.56) }
      });
      var regions = result && result.regions || {};
      ocrText = filterStableText([regions.roomName || "", regions.roomContent || ""].join("\n"));
      commerceCartVisible = detectCommerceCart(result && result.image, {
        screenSize: screenSize,
        getPixelRgb: getPixelRgb
      });
      try { if (result && result.image && result.image.recycle) result.image.recycle(); } catch (recycleError) {}
    }
    logger.info("养号直播间画面判断完成", {
      commerceCartVisible: commerceCartVisible,
      ocrTextSample: ocrText.slice(0, 160)
    });
    return { ocrText: ocrText, commerceCartVisible: commerceCartVisible };
  }

  function getPixelRgb(image, x, y) {
    try {
      var value = images.pixel ? images.pixel(image, x, y) : image.pixel(x, y);
      return { r: colors.red(value), g: colors.green(value), b: colors.blue(value) };
    } catch (error) {
      return { r: 0, g: 0, b: 0 };
    }
  }

  function findDouyinCard() {
    try { return textMatches(".*抖音.*").findOne(1200) || descMatches(".*抖音.*").findOne(1200); } catch (error) { return null; }
  }

  function recover() {
    if (String(context.deviceProfile && context.deviceProfile.key || "") === "xiaomi_14") {
      var createCleanup = postPublishCleanupModule.createDouyinPostPublishCleanup;
      if (typeof createCleanup !== "function") {
        logger.warn("小米14目标直播恢复缺少共享清理器");
        return false;
      }
      var cleanup = createCleanup({
        context: context,
        logger: logger,
        cooldownMs: 0,
        isPublishing: function () { return false; }
      });
      var cleanupResult = cleanup && typeof cleanup.run === "function"
        ? cleanup.run({ taskId: "target-live-recovery" }) : null;
      return !!(cleanupResult && cleanupResult.completed === true);
    }
    if (typeof recents === "function") recents();
    waitRandom(1000, 1600);
    var card = findDouyinCard();
    var size = screenSize();
    if (card && typeof swipe === "function") {
      var target = card;
      var bounds = null;
      for (var i = 0; i < 6 && target; i++) {
        try {
          var candidate = target.bounds && target.bounds();
          if (candidate && candidate.width() >= size.width * 0.35) { bounds = candidate; break; }
        } catch (error) {}
        try { target = target.parent && target.parent(); } catch (parentError) { target = null; }
      }
      if (bounds) {
        swipe(bounds.right - 10, bounds.centerY(), bounds.left + 10, bounds.centerY(), 420);
      }
    }
    waitRandom(700, 1200);
    if (typeof home === "function") home();
    return true;
  }

  return {
    openDouyin: function () { return douyin.openApp && douyin.openApp(); },
    openDouyinWaitRange: openDouyinWaitRange,
    openSearch: function (keyword, control) {
      if (fastSearch && fastSearch.openSearch) return fastSearch.openSearch(keyword, control);
      return douyin.openSearch && douyin.openSearch(keyword);
    },
    openLiveTab: openLiveTab,
    advanceCandidate: advanceCandidate,
    openFirstLive: function () {
      return clickFirstLiveCard({
        screenSize: screenSize,
        clickPoint: function (x, y) { return typeof click === "function" && !!click(x, y); }
      }, logger);
    },
    isLiveRoom: function () { return !!(douyin.isLiveRoomVisible && douyin.isLiveRoomVisible()); },
    readStableEvidence: readStableEvidence,
    nextLive: function () { return invokeNextLive(douyin); },
    recover: recover,
    waitRandom: waitRandom
  };
}

function clickFirstLiveCard(dependencies, logger) {
  dependencies = dependencies || {};
  logger = logger || { info: function () {} };
  var size = dependencies.screenSize ? dependencies.screenSize() : { width: 1080, height: 2400 };
  var x = Math.floor(size.width * 0.36);
  var y = Math.floor(size.height * 0.35);
  var clicked = !!(dependencies.clickPoint && dependencies.clickPoint(x, y));
  logger.info("点击搜索结果第一个直播间", { x: x, y: y, clicked: clicked });
  return clicked;
}

function detectCommerceCart(image, dependencies) {
  if (!image) return false;
  dependencies = dependencies || {};
  var size = dependencies.screenSize ? dependencies.screenSize() : { width: 1080, height: 2400 };
  var getPixelRgb = dependencies.getPixelRgb || function () { return { r: 0, g: 0, b: 0 }; };
  var left = Math.floor(size.width * 0.52);
  var right = Math.floor(size.width * 0.62);
  var top = Math.floor(size.height * 0.87);
  var bottom = Math.floor(size.height * 0.94);
  var orangeCount = 0;
  for (var y = top; y <= bottom; y += 4) {
    for (var x = left; x <= right; x += 4) {
      var rgb = getPixelRgb(image, x, y) || {};
      if (rgb.r >= 205 && rgb.g >= 70 && rgb.g <= 180 && rgb.b <= 90 && rgb.r - rgb.g >= 50 && rgb.g - rgb.b >= 25) {
        orangeCount += 1;
        if (orangeCount >= 24) return true;
      }
    }
  }
  return false;
}

function invokeNextLive(douyin) {
  if (!douyin || !douyin.nextVideo) return false;
  return douyin.nextVideo() !== false;
}

module.exports = {
  createTargetLiveEntryTask: createTargetLiveEntryTask,
  createTargetLiveRuntime: createRuntime,
  clickFirstLiveCard: clickFirstLiveCard,
  detectCommerceCart: detectCommerceCart,
  invokeNextLive: invokeNextLive
};
