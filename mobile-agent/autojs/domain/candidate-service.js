function isoNow() {
  return new Date().toISOString();
}

function pickLines(text) {
  return String(text || "")
    .split(/\n+/)
    .map(function (line) {
      return line.replace(/\s+/g, " ").trim();
    })
    .filter(function (line) {
      return line.length > 0;
    });
}

function uniqueLines(lines) {
  var seen = {};
  var result = [];
  lines.forEach(function (line) {
    if (!seen[line]) {
      seen[line] = true;
      result.push(line);
    }
  });
  return result;
}

function extractKeyInfo(screenData, hotComments) {
  var lines = uniqueLines(pickLines(screenData.combinedText));
  var metrics = lines.filter(function (line) {
    return /赞|评论|收藏|分享|万|w|W|在线|观看|人气/.test(line);
  });
  var possibleAuthors = lines.filter(function (line) {
    return /^@/.test(line) || /作者|农技|农业|种植|养殖/.test(line);
  });
  var titleLines = lines.filter(function (line) {
    return line.length >= 6 && line.length <= 80 && !/首页|朋友|消息|我|搜索|评论/.test(line);
  });

  return {
    titleText: titleLines.slice(0, 3).join(" / "),
    authorName: possibleAuthors[0] || "",
    metricsText: metrics.slice(0, 5).join(" / "),
    summaryText: titleLines.slice(0, 6).join("\n"),
    hotComments: hotComments || [],
    visibleLines: lines.slice(0, 80)
  };
}

function createCandidateService(context) {
  var config = context.config;
  var logger = context.logger;
  var storage = context.storage;
  var uploader = context.uploader;
  var douyin = context.douyin;
  var floatyControl = context.floatyControl;
  var counters = context.counters;
  var controlLoop = context.controlLoop;

  function buildCandidate(screenData, matchResult, screenshotFiles, hotComments) {
    var keyInfo = extractKeyInfo(screenData, hotComments);
    return {
      taskId: config.task.taskId,
      deviceId: config.device.deviceId,
      platform: config.task.platform,
      sourceType: "mobile_agent",
      sceneType: screenData.sceneType || "video",
      keyword: config.task.mode === "search" ? config.task.keywords[0] : "",
      currentPhase: counters.currentPhase,
      viewedCount: counters.viewedCount,
      liveViewedCount: counters.liveViewedCount,
      capturedCount: counters.capturedCount,
      captureMode: config.task.captureMode,
      match: matchResult,
      screenText: screenData.combinedText,
      ocrRegions: screenData.ocrRegions || {},
      titleText: keyInfo.titleText,
      subtitleText: keyInfo.summaryText,
      authorName: keyInfo.authorName,
      metricsText: keyInfo.metricsText,
      hotComments: keyInfo.hotComments,
      visibleLines: keyInfo.visibleLines,
      screenshotFiles: screenshotFiles || [],
      capturedAt: isoNow(),
      rawText: screenData.ocrText,
      localOnly: !config.upload.enabled
    };
  }

  function collectCandidate(screenData, matchResult, options) {
    if (options && options.fullScreenData) {
      screenData = options.fullScreenData;
    }
    if (options && options.fullMatchResult) {
      matchResult = options.fullMatchResult;
    }

    var hotComments = [];
    var collectComments = !options || options.collectComments !== false;

    if (collectComments && config.task.collectComments) {
      try {
        if (douyin.openComments()) {
          hotComments = douyin.extractHotComments(config.task.commentLimit);
          douyin.closeComments();
          if (controlLoop && controlLoop.reportRuntimeLog) {
            controlLoop.reportRuntimeLog("INFO", "评论采集完成", {
              phase: "comments",
              commentCount: hotComments.length,
              commentLimit: config.task.commentLimit
            });
          }
        }
      } catch (error) {
        logger.warn("评论采集失败", { message: String(error) });
        if (controlLoop && controlLoop.reportRuntimeLog) {
          controlLoop.reportRuntimeLog("WARN", "评论采集失败", {
            phase: "comments",
            message: String(error)
          });
        }
        douyin.closeComments();
      }
    }

    var candidate = buildCandidate(screenData, matchResult, [], hotComments);
    storage.saveCandidate(candidate);
    if (controlLoop && controlLoop.reportRuntimeLog) {
      controlLoop.reportRuntimeLog("INFO", "候选记录已写入本地缓存", {
        phase: "candidate",
        sceneType: candidate.sceneType,
        keyword: candidate.keyword,
        agricultureHits: candidate.match && candidate.match.agricultureHits ? candidate.match.agricultureHits : [],
        titleText: candidate.titleText,
        capturedCount: counters.capturedCount
      });
    }
    var uploadResult = uploader.upload(candidate);
    if (controlLoop && controlLoop.reportRuntimeLog) {
      controlLoop.reportRuntimeLog(uploadResult.success ? "INFO" : "WARN", uploadResult.success ? "候选记录上传成功" : "候选记录上传失败", {
        phase: "candidate_upload",
        sceneType: candidate.sceneType,
        keyword: candidate.keyword,
        success: !!uploadResult.success,
        statusCode: uploadResult.statusCode,
        message: uploadResult.message || "",
        titleText: candidate.titleText
      });
    }

    counters.capturedCount += 1;
    floatyControl.update({
      capturedCount: counters.capturedCount,
      lastMessage: uploadResult.success ? "采集并上传成功" : "采集已缓存"
    });
  }

  return {
    collectCandidate: collectCandidate
  };
}

module.exports = {
  createCandidateService: createCandidateService
};
