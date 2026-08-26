// Bounded OCR/swipe loop used after a live room is confirmed.
function loadLiveCommentDependency(context, path, fallback) {
  if (context && context.forceBaselineLiveCommentEntry && typeof context.loadBaselineScript === "function") {
    return context.loadBaselineScript(path);
  }
  if (context && typeof context.loadBizScript === "function") {
    return context.loadBizScript(path);
  }
  return fallback();
}

var COMMENT_OCR_ATTEMPTS = 3;
var MAX_CONSECUTIVE_NO_NEW_PAGES = 2;

function createCommentCaptureRunner(options) {
  options = options || {};
  var context = options.context || {};
  var commentCapture = options.commentCapture || loadLiveCommentDependency(context,
    "domain/live-comment-capture.js",
    function () { return require("../../domain/live-comment-capture.js"); });
  var runtime = options.runtime || {};
  var stage = options.stage || function () {};
  var call = options.call;
  var stopped = options.stopped || function () { return false; };
  var detectPlatformVerification = options.detectPlatformVerification || function () { return null; };
  var platformVerificationFailure = options.platformVerificationFailure || function (failedStage, detection) {
    detection = detection || {};
    return {
      status: "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION",
      reasonCode: "PLATFORM_VERIFICATION",
      message: "出现平台验证",
      failedStage: failedStage,
      cleanupRequired: true,
      platformVerification: true,
      capturePlatformVerification: true,
      textSample: String(detection.textSample || "").slice(0, 260)
    };
  };

  function candidates(pages, scope) {
    return commentCapture.buildCandidates(pages, scope);
  }

  function failure(failedStage, reasonCode, message, details) {
    details = details || {};
    var pages = details.pages || [];
    var partial = candidates(pages, details.scope || {});
    stage("COMMENT_CAPTURE_FAILED", {
      failedStage: failedStage,
      reasonCode: reasonCode,
      message: message,
      pageIndex: details.pageIndex,
      swipeCount: details.swipeCount,
      pageCount: pages.length,
      commentCount: partial.length,
      comments: partial
    });
    return {
      status: "LIVE_COMMENT_ENTRY_COMMENT_CAPTURE_FAILED",
      failedStage: failedStage,
      reasonCode: reasonCode,
      message: message,
      pageIndex: details.pageIndex === undefined ? null : details.pageIndex,
      swipeCount: details.swipeCount === undefined ? 0 : details.swipeCount,
      pageCount: pages.length,
      commentCount: partial.length,
      comments: partial
    };
  }

  function stoppedResult(pages, scope, swipeCount) {
    var partial = candidates(pages, scope);
    return {
      status: "STOPPED",
      captureCompleted: false,
      commentSwipeCount: swipeCount || 0,
      commentPageCount: pages.length,
      commentCount: partial.length,
      commentSourceCount: commentCapture.flattenPages(pages).length,
      comments: partial
    };
  }

  function verificationResult(failedStage, phase, details) {
    details = details || {};
    var detection = detectPlatformVerification(failedStage, details.control, {
      capturePhase: true,
      phase: phase,
      pageIndex: details.pageIndex,
      ocrAttempt: details.ocrAttempt,
      swipeIndex: details.swipeIndex
    });
    if (!detection) return null;
    var partial = candidates(details.pages || [], details.scope || {});
    var result = platformVerificationFailure(failedStage, detection, {
      capturePhase: true,
      phase: phase,
      pageIndex: details.pageIndex,
      ocrAttempt: details.ocrAttempt,
      swipeIndex: details.swipeIndex,
      commentCount: partial.length
    });
    result.platformVerification = true;
    result.capturePlatformVerification = true;
    result.pageIndex = details.pageIndex === undefined ? null : details.pageIndex;
    result.swipeCount = details.swipeCount === undefined ? 0 : details.swipeCount;
    result.pageCount = (details.pages || []).length;
    result.commentCount = partial.length;
    result.comments = partial;
    return result;
  }

  function capture(scope, control) {
    var maxSwipeCount = commentCapture.COMMENT_SWIPE_COUNT;
    var pages = [];
    var actualSwipeCount = 0;
    var knownCommentCount = 0;
    var consecutiveNoNewPages = 0;
    var stoppedEarly = false;
    for (var pageIndex = 0; pageIndex <= maxSwipeCount; pageIndex += 1) {
      if (stopped(control)) return stoppedResult(pages, scope, actualSwipeCount);
      var pageComments = [];
      var lastReadFailure = null;
      for (var ocrAttempt = 1; ocrAttempt <= COMMENT_OCR_ATTEMPTS; ocrAttempt += 1) {
        var beforeReadVerification = verificationResult("CAPTURING_COMMENTS", "before", {
          control: control,
          pageIndex: pageIndex,
          ocrAttempt: ocrAttempt,
          swipeCount: actualSwipeCount,
          pages: pages,
          scope: scope
        });
        if (beforeReadVerification) return beforeReadVerification;
        if (typeof runtime.readComments !== "function") {
          return failure(
            "CAPTURING_COMMENTS",
            "COMMENT_OCR_UNAVAILABLE",
            "评论区域 OCR 能力不可用，脚本已停止",
            { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pages, scope: scope }
          );
        }
        stage("CAPTURING_COMMENTS", {
          pageIndex: pageIndex,
          pageCount: pages.length + 1,
          maxPageCount: maxSwipeCount + 1,
          swipeCount: actualSwipeCount,
          maxSwipeCount: maxSwipeCount,
          ocrAttempt: ocrAttempt
        });
        var read = call("readComments", "CAPTURING_COMMENTS", [], control);
        if (read.stopped) return stoppedResult(pages, scope, actualSwipeCount);
        var readComments = [];
        if (!read.failed) {
          var value = read.value || {};
          var rawText = typeof value === "string"
            ? value
            : String(value.text || value.commentText || value.rawText || "");
          readComments = commentCapture.parseCommentLines(rawText);
        }
        var verificationPages = readComments.length
          ? pages.concat([{ pageIndex: pageIndex, comments: readComments }])
          : pages;
        var afterReadVerification = verificationResult("CAPTURING_COMMENTS", "after", {
          control: control,
          pageIndex: pageIndex,
          ocrAttempt: ocrAttempt,
          swipeCount: actualSwipeCount,
          pages: verificationPages,
          scope: scope
        });
        if (afterReadVerification) return afterReadVerification;
        if (read.failed) {
          lastReadFailure = read;
        } else {
          pageComments = readComments;
          if (pageComments.length) break;
          lastReadFailure = null;
        }
        if (ocrAttempt < COMMENT_OCR_ATTEMPTS) {
          stage("RETRYING_COMMENT_OCR", {
            pageIndex: pageIndex,
            nextAttempt: ocrAttempt + 1,
            reasonCode: lastReadFailure ? "COMMENT_OCR_FAILED" : "COMMENT_OCR_EMPTY"
          });
          if (runtime.waitRandom) runtime.waitRandom(350, 650);
        }
      }

      if (lastReadFailure) {
        return failure(
          "CAPTURING_COMMENTS",
          "COMMENT_OCR_FAILED",
          lastReadFailure.message || "评论区域 OCR 失败",
          { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pages, scope: scope }
        );
      }
      pages.push({ pageIndex: pageIndex, comments: pageComments });
      var partial = candidates(pages, scope);
      var newCommentCount = Math.max(0, partial.length - knownCommentCount);
      knownCommentCount = partial.length;
      if (pageIndex > 0) {
        consecutiveNoNewPages = newCommentCount > 0 ? 0 : consecutiveNoNewPages + 1;
      }
      stage("COMMENT_PAGE_CAPTURED", {
        pageIndex: pageIndex,
        pageCount: pages.length,
        maxPageCount: maxSwipeCount + 1,
        swipeCount: actualSwipeCount,
        maxSwipeCount: maxSwipeCount,
        newCommentCount: newCommentCount,
        consecutiveNoNewPageCount: consecutiveNoNewPages,
        commentCount: partial.length,
        commentSourceCount: commentCapture.flattenPages(pages).length,
        captureCompleted: false,
        comments: partial
      });

      if (pageIndex > 0 && consecutiveNoNewPages >= MAX_CONSECUTIVE_NO_NEW_PAGES) {
        stoppedEarly = actualSwipeCount < maxSwipeCount;
        break;
      }
      if (actualSwipeCount >= maxSwipeCount) break;
      if (stopped(control)) return stoppedResult(pages, scope, actualSwipeCount);
      var beforeSwipeVerification = verificationResult("SWIPING_COMMENTS", "before", {
        control: control,
        pageIndex: pageIndex,
        swipeIndex: actualSwipeCount + 1,
        swipeCount: actualSwipeCount,
        pages: pages,
        scope: scope
      });
      if (beforeSwipeVerification) return beforeSwipeVerification;
      if (typeof runtime.swipeComments !== "function") {
        return failure(
          "SWIPING_COMMENTS",
          "COMMENT_SWIPE_UNAVAILABLE",
          "评论区上滑能力不可用，脚本已停止",
          { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pages, scope: scope }
        );
      }
      stage("SWIPING_COMMENTS", {
        swipeIndex: actualSwipeCount + 1,
        swipeCount: actualSwipeCount,
        maxSwipeCount: maxSwipeCount
      });
      var swipeResult = call("swipeComments", "SWIPING_COMMENTS", [], control);
      if (swipeResult.stopped) return stoppedResult(pages, scope, actualSwipeCount);
      var completedSwipeCount = swipeResult.failed ? actualSwipeCount : actualSwipeCount + 1;
      var afterSwipeVerification = verificationResult("SWIPING_COMMENTS", "after", {
        control: control,
        pageIndex: pageIndex,
        swipeIndex: actualSwipeCount + 1,
        swipeCount: completedSwipeCount,
        pages: pages,
        scope: scope
      });
      if (afterSwipeVerification) return afterSwipeVerification;
      if (swipeResult.failed) {
        return failure(
          "SWIPING_COMMENTS",
          "COMMENT_SWIPE_FAILED",
          swipeResult.message || "评论区上滑失败",
          { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pages, scope: scope }
        );
      }
      actualSwipeCount = completedSwipeCount;
      if (runtime.waitRandom) runtime.waitRandom(700, 1200);
    }

    var captured = candidates(pages, scope);
    if (!captured.length) {
      return failure(
        "CAPTURING_COMMENTS",
        "COMMENT_OCR_EMPTY",
        "连续两个已翻页页面未识别到新增有效评论，脚本已停止",
        {
          pageIndex: pages.length ? pages[pages.length - 1].pageIndex : null,
          swipeCount: actualSwipeCount,
          pages: pages,
          scope: scope
        }
      );
    }
    var sourceCount = commentCapture.flattenPages(pages).length;
    stage("COMMENTS_CAPTURED", {
      pageCount: pages.length,
      maxPageCount: maxSwipeCount + 1,
      swipeCount: actualSwipeCount,
      maxSwipeCount: maxSwipeCount,
      captureStopReason: stoppedEarly ? "NO_NEW_COMMENTS" : "SWIPE_LIMIT_REACHED",
      commentCount: captured.length,
      commentSourceCount: sourceCount,
      captureStatus: "LIVE_COMMENT_ENTRY_CAPTURED",
      captureCompleted: true,
      comments: captured
    });
    return {
      // Keep the legacy terminal status so hot-updated business scripts remain
      // compatible with already-installed command bridges.
      status: "LIVE_COMMENT_ENTRY_ENTERED",
      captureStatus: "LIVE_COMMENT_ENTRY_CAPTURED",
      captureCompleted: true,
      commentSwipeCount: actualSwipeCount,
      commentPageCount: pages.length,
      captureStopReason: stoppedEarly ? "NO_NEW_COMMENTS" : "SWIPE_LIMIT_REACHED",
      commentCount: captured.length,
      commentSourceCount: sourceCount,
      comments: captured
    };
  }

  return { capture: capture };
}

module.exports = {
  COMMENT_OCR_ATTEMPTS: COMMENT_OCR_ATTEMPTS,
  MAX_CONSECUTIVE_NO_NEW_PAGES: MAX_CONSECUTIVE_NO_NEW_PAGES,
  createCommentCaptureRunner: createCommentCaptureRunner
};
