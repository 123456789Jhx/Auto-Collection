function createLiveCommentReadonlyProbe(context) {
  var config = context.config;
  var logger = context.logger;
  var douyin = context.douyin;
  var detector = context.detector;
  var reader = context.reader;
  var commentCache = context.commentCache;
  var triggerDetector = context.triggerDetector;
  var actionPlanner = context.actionPlanner;
  var storage = context.storage;
  var uploader = context.uploader;
  var expectedPackage = "com.ss.android.ugc.aweme";

  function nowIso() {
    return new Date().toISOString();
  }

  function getCurrentPackageName() {
    try {
      return currentPackage();
    } catch (error) {
      return "";
    }
  }

  function sleepMs(ms) {
    sleep(Number(ms || 1000));
  }

  function waitForPackage(packageName, timeoutMs) {
    var deadline = Date.now() + Number(timeoutMs || 5000);
    while (Date.now() < deadline) {
      if (getCurrentPackageName() === packageName) {
        return true;
      }
      sleepMs(500);
    }
    return getCurrentPackageName() === packageName;
  }

  function recoverDouyinForeground(reason) {
    logger.warn("M3只读验证：抖音不在前台，尝试恢复前台", {
      reason: reason || "",
      currentPackageName: getCurrentPackageName()
    });
    try {
      app.launchPackage(expectedPackage);
    } catch (error) {
      logger.warn("M3只读验证：恢复抖音前台失败", { message: String(error) });
      return false;
    }
    return waitForPackage(expectedPackage, 6000);
  }

  function captureText() {
    var texts = [];
    try {
      var nodes = className("android.widget.TextView").find();
      if (!nodes) {
        return "";
      }
      for (var i = 0; i < nodes.length; i++) {
        var value = nodes[i].text && nodes[i].text();
        if (value) {
          texts.push(value);
        }
      }
    } catch (error) {
      logger.warn("M3只读采样文本读取失败", { message: String(error) });
    }
    return texts.join("\n");
  }

  function closeKnownOverlayForProbe(reason) {
    for (var i = 0; i < 3; i++) {
      var textSample = captureText();
      if (!/期待你的评论|条评论|评论\n|评论$|大家都在搜|发送\n购物|选择音乐|相机|开直播|翻转|闪光灯/.test(textSample)) {
        return true;
      }
      logger.warn("M3只读验证：检测到浮层，返回恢复直播入口上下文", {
        reason: reason || "",
        backIndex: i + 1,
        textSample: textSample.slice(0, 160)
      });
      back();
      sleepMs(1200);
    }
    return true;
  }

  function clickNode(node, label) {
    if (!node || !node.bounds) {
      return false;
    }
    try {
      if (node.clickable && node.clickable() && node.click()) {
        sleepMs(800);
        return true;
      }
    } catch (error) {
    }
    try {
      var bounds = node.bounds();
      var x = bounds.centerX();
      var y = bounds.centerY();
      logger.info("M3只读验证：坐标点击控件", {
        label: label || "",
        x: x,
        y: y,
        bounds: "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]"
      });
      click(x, y);
      sleepMs(800);
      return true;
    } catch (error2) {
      logger.warn("M3只读验证：点击控件失败", { label: label || "", message: String(error2) });
    }
    return false;
  }

  function findTopLiveTab() {
    var nodes = [];
    try {
      var textNodes = text("直播").find();
      for (var i = 0; textNodes && i < textNodes.length; i++) {
        nodes.push(textNodes[i]);
      }
    } catch (error) {
    }
    try {
      var descNodes = descMatches(".*直播.*按钮.*").find();
      for (var j = 0; descNodes && j < descNodes.length; j++) {
        nodes.push(descNodes[j]);
      }
    } catch (error2) {
    }

    var best = null;
    var bestScore = -1;
    var width = device && device.width ? device.width : 1080;
    var height = device && device.height ? device.height : 2248;
    for (var k = 0; k < nodes.length; k++) {
      var node = nodes[k];
      var bounds = node.bounds && node.bounds();
      if (!bounds) {
        continue;
      }
      var centerX = bounds.centerX();
      var centerY = bounds.centerY();
      if (centerY < height * 0.03 || centerY > height * 0.22) {
        continue;
      }
      if (centerX < width * 0.45 || centerX > width * 0.85) {
        continue;
      }
      var score = 10;
      if (node.clickable && node.clickable()) {
        score += 3;
      }
      if (centerY < height * 0.12) {
        score += 2;
      }
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  function enterLiveFeedLight() {
    logger.info("M3只读验证：轻量进入直播Tab");
    closeKnownOverlayForProbe("before_enter_live_tab");
    sleepMs(1800);
    var liveTab = findTopLiveTab();
    if (liveTab) {
      return clickNode(liveTab, "top_live_tab");
    }
    var width = device && device.width ? device.width : 1080;
    logger.warn("M3只读验证：未找到直播Tab控件，使用顶部坐标兜底");
    click(Math.floor(width * 0.69), 150);
    sleepMs(1200);
    return true;
  }

  function sample(index) {
    var text = captureText();
    var currentPackageName = getCurrentPackageName();
    var state = detector.detect(text, {
      currentPackageName: currentPackageName
    });
    var comments = state.readyForCommentRead ? reader.readFromText(text) : [];
    var addedComments = commentCache ? commentCache.addMany(comments, {
      sampledAt: nowIso(),
      source: "live_comment_readonly_probe"
    }) : comments;
    var triggerEvents = [];
    var plannedActions = [];
    if (triggerDetector && actionPlanner) {
      var cachedComments = addedComments;
      for (var i = 0; i < cachedComments.length; i++) {
        var triggerEvent = triggerDetector.detect(cachedComments[i], {
          taskId: config.task.taskId,
          deviceId: config.device.deviceId,
          roomName: ""
        });
        if (!triggerEvent) {
          continue;
        }
        var plannedAction = actionPlanner.plan(triggerEvent);
        triggerEvents.push(triggerEvent);
        plannedActions.push(plannedAction);
        if (storage && storage.appendLiveCommentLog) {
          var logEntry = {
            type: "live_comment_plan",
            sampleIndex: index,
            taskId: config.task.taskId,
            deviceId: config.device.deviceId,
            groupName: plannedAction.groupName,
            triggerEventId: triggerEvent.eventId,
            triggerText: triggerEvent.triggerText,
            triggerAuthor: triggerEvent.leaderAccountName,
            matchedKeywords: triggerEvent.matchedKeywords,
            confidence: triggerEvent.confidence,
            replyText: plannedAction.replyText,
            plannedDelayMs: plannedAction.plannedDelayMs,
            status: plannedAction.status,
            skipReason: plannedAction.skipReason,
            plannedAt: plannedAction.plannedAt
          };
          storage.appendLiveCommentLog(logEntry);
          if (uploader && uploader.uploadLiveCommentAction) {
            uploader.uploadLiveCommentAction(logEntry);
          }
        }
      }
    }
    var result = {
      index: index,
      sampledAt: nowIso(),
      currentPackageName: currentPackageName,
      state: state.state,
      readyForCommentRead: state.readyForCommentRead,
      reasons: state.reasons,
      commentCount: comments.length,
      cachedCommentCount: commentCache ? commentCache.size() : comments.length,
      addedCommentCount: addedComments.length,
      triggerEventCount: triggerEvents.length,
      plannedActionCount: plannedActions.length,
      comments: comments.slice(0, 8),
      triggerEvents: triggerEvents.slice(0, 5),
      plannedActions: plannedActions.slice(0, 5),
      textSample: text.slice(0, 260)
    };
    logger.info("M3只读采样", result);
    return result;
  }

  function maybeEnterLiveRoom(result, options) {
    if (!options.tryEnterLiveRoom || result.state !== "live_feed") {
      return false;
    }
    logger.info("M3只读验证：尝试从直播流进入直播间");
    return !!douyin.openLiveRoomFromCurrentScreen(result.textSample);
  }

  function run(options) {
    options = options || {};
    var maxSamples = Number(options.maxSamples || 20);
    var sampleIntervalMs = Number(options.sampleIntervalMs || 1200);
    var externalLaunchWaitMs = Number(options.externalLaunchWaitMs || 0);
    var maxForegroundRecoveries = Number(options.maxForegroundRecoveries || 2);
    var maxLiveEntryAttempts = Number(options.maxLiveEntryAttempts || 2);
    var foregroundRecoveries = 0;
    var liveEntryAttempts = 0;
    var results = [];

    logger.info("M3只读验证启动", {
      maxSamples: maxSamples,
      sampleIntervalMs: sampleIntervalMs,
      tryEnterLiveRoom: !!options.tryEnterLiveRoom,
      externalLaunchWaitMs: externalLaunchWaitMs,
      maxForegroundRecoveries: maxForegroundRecoveries,
      maxLiveEntryAttempts: maxLiveEntryAttempts
    });

    if (externalLaunchWaitMs > 0) {
      logger.info("M3只读验证：等待外部拉起抖音", { waitMs: externalLaunchWaitMs });
      var deadline = Date.now() + externalLaunchWaitMs;
      while (Date.now() < deadline && getCurrentPackageName() !== expectedPackage) {
        sleepMs(500);
      }
    } else {
      douyin.openApp();
    }

    if (getCurrentPackageName() !== expectedPackage) {
      throw new Error("抖音未在前台，停止只读验证");
    }

    var initialText = captureText();
    var initialState = detector.detect(initialText, {
      currentPackageName: getCurrentPackageName()
    });
    logger.info("M3只读验证：初始页面状态", {
      state: initialState.state,
      reasons: initialState.reasons,
      textSample: initialText.slice(0, 180)
    });
    if (initialState.state !== "live_room") {
      enterLiveFeedLight();
      sleepMs(1500);
    }

    for (var i = 0; i < maxSamples; i++) {
      var result = sample(i + 1);
      results.push(result);

      if (result.state === "blocked" || result.state === "outside_douyin") {
        if (result.state === "outside_douyin" && foregroundRecoveries < maxForegroundRecoveries) {
          foregroundRecoveries++;
          if (recoverDouyinForeground("sample_" + result.index)) {
            sleepMs(1200);
            continue;
          }
        }
        logger.warn("M3只读验证遇到阻断状态，停止", result);
        break;
      }

      if (result.state === "live_feed" && liveEntryAttempts < maxLiveEntryAttempts) {
        liveEntryAttempts++;
        maybeEnterLiveRoom(result, options);
      }
      sleepMs(sampleIntervalMs);
    }

    logger.info("M3只读验证完成", {
      sampleCount: results.length,
      lastState: results.length ? results[results.length - 1].state : "",
      cachedCommentCount: commentCache ? commentCache.size() : 0,
      actionPlannerState: actionPlanner && actionPlanner.getState ? actionPlanner.getState() : null
    });
    return results;
  }

  return {
    run: run
  };
}

module.exports = {
  createLiveCommentReadonlyProbe: createLiveCommentReadonlyProbe
};
