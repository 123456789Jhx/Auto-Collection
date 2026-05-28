function createDouyinAdapter(config, logger, ocrEngine) {
  var autojsUtils = require(files.join(config.runtime.scriptDir, "utils/autojs-utils.js"));
  var packageName = "com.ss.android.ugc.aweme";

  function dismissStartupPopups() {
    autojsUtils.clickIfExists(textMatches(/.*(允许).*/).clickable(true), 1500, logger);

    var starCardNode =
      autojsUtils.waitForElement(textContains("玩转抖音星卡"), 1000, null, logger) ||
      autojsUtils.waitForElement(descContains("玩转抖音星卡"), 1000, null, logger);
    if (starCardNode) {
      logger.warn("检测到抖音活动 WebView，尝试返回首页");
      back();
      autojsUtils.sleepRandom(1200, 2000);
    }

    var tipNode = autojsUtils.waitForElement(text("温馨提示"), 1500, null, logger);
    if (tipNode) {
      autojsUtils.clickPoint(device.width / 2, device.height * 0.85);
    }

    var continueEditNode = autojsUtils.waitForElement(text("继续编辑作品吗？"), 1500, null, logger);
    if (continueEditNode) {
      autojsUtils.clickIfExists(desc("取消"), 1000, logger);
      autojsUtils.clickIfExists(text("取消"), 1000, logger);
    }
  }

  function openApp() {
    logger.info("打开抖音");
    home();
    autojsUtils.sleepRandom(1000, 2000);

    var launched = app.launchApp("抖音") || app.launchPackage(packageName);
    if (!launched) {
      throw new Error("抖音打开失败");
    }

    autojsUtils.sleepRandom(3000, 5000);
    dismissStartupPopups();
    autojsUtils.sleepRandom(2000, 4000);

    var homeNode =
      autojsUtils.waitForElement(text("首页"), 6000, null, logger) ||
      autojsUtils.waitForElement(desc("首页"), 2000, null, logger);
    if (!homeNode) {
      logger.warn("未检测到抖音首页控件，继续尝试执行");
    }
    return !!launched;
  }

  function openSearch(keyword) {
    logger.info("尝试进入抖音搜索", { keyword: keyword });
    autojsUtils.verifyApp("抖音", logger);

    var searchNode =
      autojsUtils.waitForElement(desc("搜索"), 3000, null, logger) ||
      autojsUtils.waitForElement(descContains("搜索"), 2000, null, logger) ||
      autojsUtils.waitForElement(text("搜索"), 2000, null, logger) ||
      autojsUtils.waitForElement(textContains("搜索"), 2000, null, logger);

    if (searchNode) {
      autojsUtils.safeClick(searchNode, 3, logger);
      autojsUtils.sleepRandom(1200, 2000);
      setText(keyword);
      autojsUtils.sleepRandom(1000, 1500);

      var searchButton =
        autojsUtils.waitForElement(text("搜索"), 3000, null, logger) ||
        autojsUtils.waitForElement(desc("搜索"), 1000, null, logger);
      if (searchButton) {
        autojsUtils.axisClick(searchButton, logger);
      } else {
        press("enter");
      }
      autojsUtils.sleepRandom(2500, 4000);
      return true;
    }
    logger.warn("未找到搜索入口，保留在当前页面");
    return false;
  }

  function enterVideoFeed() {
    logger.info("进入视频流");
    sleep(1500);
    return true;
  }

  function enterLiveFeed(keyword) {
    logger.info("进入直播流", { keyword: keyword });
    openSearch(keyword || "农业");

    var liveTab =
      autojsUtils.waitForElement(text("直播"), 4000, null, logger) ||
      autojsUtils.waitForElement(desc("直播"), 2000, null, logger) ||
      autojsUtils.waitForElement(textContains("直播"), 2000, null, logger);
    if (liveTab) {
      autojsUtils.safeClick(liveTab, 3, logger);
      autojsUtils.sleepRandom(2500, 4000);
      return true;
    }

    logger.warn("未找到直播 Tab，保留在搜索结果流采集");
    return false;
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
    var result = ocrEngine.captureAndRecognize();
    var visibleText = extractVisibleText();
    var combinedText = [result.text, visibleText].filter(Boolean).join("\n");
    return {
      image: result.image,
      ocrText: result.text,
      visibleText: visibleText,
      combinedText: combinedText
    };
  }

  function openComments() {
    logger.info("尝试打开评论面板");
    var commentNode =
      autojsUtils.waitForElement(descMatches(/评论|评论区/), 1500, null, logger) ||
      autojsUtils.waitForElement(textMatches(/评论|评论区/), 1500, null, logger);

    if (commentNode) {
      autojsUtils.safeClick(commentNode, 3, logger);
      autojsUtils.sleepRandom(1800, 2600);
      return true;
    }

    var width = device.width;
    var height = device.height;
    autojsUtils.clickPoint(width - 70, Math.floor(height * 0.55));
    autojsUtils.sleepRandom(1800, 2600);
    return true;
  }

  function extractHotComments(limit) {
    var comments = [];
    var nodes = className("android.widget.TextView").find();
    for (var i = 0; i < nodes.length && comments.length < limit; i++) {
      var value = nodes[i].text();
      if (value && value.length >= 2 && value.length <= 120) {
        comments.push(value);
      }
    }
    return comments;
  }

  function closeComments() {
    back();
    autojsUtils.sleepRandom(800, 1200);
  }

  function nextVideo() {
    var width = device.width;
    var height = device.height;
    swipe(
      Math.floor(width * 0.5),
      Math.floor(height * 0.78),
      Math.floor(width * 0.5),
      Math.floor(height * 0.22),
      config.runtime.swipeDurationMs
    );
    autojsUtils.sleepRandom(1200, 2000);
  }

  function recover() {
    logger.warn("执行抖音页面恢复");
    back();
    autojsUtils.sleepRandom(800, 1200);
    enterVideoFeed();
  }

  return {
    openApp: openApp,
    openSearch: openSearch,
    enterVideoFeed: enterVideoFeed,
    enterLiveFeed: enterLiveFeed,
    extractScreen: extractScreen,
    openComments: openComments,
    extractHotComments: extractHotComments,
    closeComments: closeComments,
    nextVideo: nextVideo,
    recover: recover
  };
}

module.exports = {
  createDouyinAdapter: createDouyinAdapter
};
