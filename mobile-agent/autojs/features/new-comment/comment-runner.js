"use strict";
var defaultCommentCapture = require("./comment-capture.js");
var COMMENT_OCR_ATTEMPTS = 3;
var MAX_CONSECUTIVE_NO_NEW_PAGES = 2;
function createCommentCaptureRunner(options) {
  options = options || {};
  var runtime = options.runtime || {};
  var commentCapture = options.commentCapture || defaultCommentCapture;
  var reportStage = options.reportStage;
  var stageAlias = options.stage;
  var callAction = options.callAction || options.call;
  var stopChecker = options.shouldStop || options.stopped;
  var defaultControl = options.control;
  var detector = options.detectPlatformVerification;
  var verificationFailure = options.platformVerificationFailure;
  function assign(target, source) {
    Object.keys(source || {}).forEach(function (key) { target[key] = source[key]; });
    return target;
  }
  function stage(name, payload) {
    if (typeof reportStage === "function") {
      reportStage(assign({ stage: name }, payload));
    } else if (typeof stageAlias === "function") {
      stageAlias(name, payload || {});
    }
  }
  function activeControl(control) {
    return control || defaultControl;
  }
  function stopped(control) {
    var active = activeControl(control);
    try {
      if (typeof stopChecker === "function") return !!stopChecker(active);
      if (active && typeof active.shouldStop === "function") return !!active.shouldStop();
      if (active && typeof active.stopped === "function") return !!active.stopped();
      return !!(active && (active.stopped === true || active.stopRequested === true));
    } catch (error) {
      return true;
    }
  }

  function stopReason(value) {
    return value && (value.reason === "STOP_REQUESTED" || value.reasonCode === "STOP_REQUESTED");
  }

  function normalizeAction(raw, failedStage, fromCaller) {
    if (raw && raw.stopped) return { stopped: true, value: raw.value };
    if (raw && raw.failed) {
      if (stopReason(raw) || stopReason(raw.value)) return { stopped: true, value: raw.value };
      return {
        failed: true,
        value: raw.value,
        message: String(raw.message || raw.reason || failedStage)
      };
    }
    if (fromCaller && raw && raw.success === undefined &&
        Object.prototype.hasOwnProperty.call(raw, "value")) {
      return normalizeAction(raw.value, failedStage, false);
    }
    if (raw === false || raw && raw.success === false) {
      if (stopReason(raw)) return { stopped: true };
      return {
        failed: true,
        value: raw,
        message: String(raw && (raw.message || raw.stage || raw.reason) || failedStage)
      };
    }
    if (raw && raw.success === true) {
      return { value: raw.value };
    }
    return { value: raw };
  }

  function invoke(name, failedStage, args, control) {
    if (stopped(control)) return { stopped: true };
    var raw;
    try {
      raw = typeof callAction === "function"
        ? callAction(name, failedStage, args || [], activeControl(control))
        : runtime[name].apply(runtime, args || []);
    } catch (error) {
      return stopped(control)
        ? { stopped: true }
        : { failed: true, message: String(error && error.message || error) };
    }
    var result = normalizeAction(raw, failedStage, typeof callAction === "function");
    if (!result.stopped && stopped(control)) {
      result.stopped = true;
      result.completed = !result.failed;
    }
    return result;
  }

  function actionAvailable(name) {
    return typeof callAction === "function" || typeof runtime[name] === "function";
  }

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

  function detectedValue(raw) {
    if (!raw) return null;
    if (raw.success === true) raw = raw.value;
    if (!raw) return null;
    if (raw.success === false) {
      if (stopReason(raw)) return { stopped: true };
      if (raw.reason !== "PLATFORM_VERIFICATION" && raw.reasonCode !== "PLATFORM_VERIFICATION") return null;
      return assign(assign({}, raw.details), {
        detected: true,
        textSample: String(raw.details && raw.details.textSample || raw.textSample || "")
      });
    }
    if (raw === true) return { detected: true };
    if (raw.detected === true || raw.platformVerification === true ||
        raw.reason === "PLATFORM_VERIFICATION" || raw.reasonCode === "PLATFORM_VERIFICATION") {
      return raw;
    }
    return null;
  }

  function verificationResult(failedStage, phase, details) {
    details = details || {};
    if (stopped(details.control)) return { stopped: true };
    var check = detector || runtime.detectPlatformVerification;
    if (typeof check !== "function") return null;
    var metadata = {
      capturePhase: true,
      phase: phase,
      pageIndex: details.pageIndex,
      ocrAttempt: details.ocrAttempt,
      swipeIndex: details.swipeIndex
    };
    var raw;
    try {
      raw = detector
        ? check(failedStage, activeControl(details.control), metadata)
        : check.call(runtime, failedStage, metadata);
    } catch (error) {
      return stopped(details.control) ? { stopped: true } : null;
    }
    if (stopped(details.control)) return { stopped: true };
    var detection = detectedValue(raw);
    if (!detection) return null;
    if (detection.stopped) return { stopped: true };
    var partial = candidates(details.pages || [], details.scope || {});
    var buildFailure = verificationFailure || function (stageName, found) {
      return {
        status: "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION",
        reasonCode: "PLATFORM_VERIFICATION",
        message: "出现平台验证",
        failedStage: stageName,
        cleanupRequired: true,
        textSample: String(found.textSample || "").slice(0, 260)
      };
    };
    var failureDetails = assign({}, metadata);
    failureDetails.commentCount = partial.length;
    var result = buildFailure(failedStage, detection, failureDetails);
    if (result && result.success === true) result = result.value;
    result = result || {};
    result.platformVerification = true;
    result.capturePlatformVerification = true;
    if (result.cleanupRequired === undefined) result.cleanupRequired = true;
    result.pageIndex = details.pageIndex === undefined ? null : details.pageIndex;
    result.swipeCount = details.swipeCount === undefined ? 0 : details.swipeCount;
    result.pageCount = (details.pages || []).length;
    result.commentCount = partial.length;
    result.comments = partial;
    return result;
  }

  function rawCommentText(value) {
    if (typeof value === "string") return value;
    value = value || {};
    return String(value.text || value.commentText || value.rawText || "");
  }

  function waitBetween(min, max, failedStage, reasonCode, details) {
    if (!actionAvailable("waitRandom")) {
      return stopped(details.control) ? stoppedResult(details.pages, details.scope, details.swipeCount) : null;
    }
    var waited = invoke("waitRandom", failedStage, [min, max], details.control);
    if (waited.stopped) return stoppedResult(details.pages, details.scope, details.swipeCount);
    if (waited.failed) {
      return failure(failedStage, reasonCode, waited.message, details);
    }
    return null;
  }

  function capture(scope, control) {
    scope = scope || {};
    var configuredMax = Number(commentCapture.COMMENT_SWIPE_COUNT);
    var maxSwipeCount = isFinite(configuredMax)
      ? Math.max(0, Math.min(defaultCommentCapture.COMMENT_SWIPE_COUNT, Math.floor(configuredMax)))
      : defaultCommentCapture.COMMENT_SWIPE_COUNT;
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
        var verification = verificationResult("CAPTURING_COMMENTS", "before", {
          control: control, pageIndex: pageIndex, ocrAttempt: ocrAttempt,
          swipeCount: actualSwipeCount, pages: pages, scope: scope
        });
        if (verification && verification.stopped) return stoppedResult(pages, scope, actualSwipeCount);
        if (verification) return verification;
        if (!actionAvailable("readComments")) {
          return failure("CAPTURING_COMMENTS", "COMMENT_OCR_UNAVAILABLE",
            "评论区域 OCR 能力不可用，脚本已停止",
            { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pages, scope: scope });
        }
        stage("CAPTURING_COMMENTS", {
          pageIndex: pageIndex, pageCount: pages.length + 1, maxPageCount: maxSwipeCount + 1,
          swipeCount: actualSwipeCount, maxSwipeCount: maxSwipeCount, ocrAttempt: ocrAttempt
        });
        var read = invoke("readComments", "CAPTURING_COMMENTS", [], control);
        var readComments = [];
        if (!read.failed && (!read.stopped || read.completed)) {
          try {
            readComments = commentCapture.parseCommentLines(rawCommentText(read.value));
          } catch (error) {
            read = { failed: true, message: String(error && error.message || error) };
          }
        }
        if (read.stopped) {
          if (!read.failed) pages.push({ pageIndex: pageIndex, comments: readComments });
          return stoppedResult(pages, scope, actualSwipeCount);
        }
        var verificationPages = readComments.length
          ? pages.concat([{ pageIndex: pageIndex, comments: readComments }])
          : pages;
        verification = verificationResult("CAPTURING_COMMENTS", "after", {
          control: control, pageIndex: pageIndex, ocrAttempt: ocrAttempt,
          swipeCount: actualSwipeCount, pages: verificationPages, scope: scope
        });
        if (verification && verification.stopped) return stoppedResult(verificationPages, scope, actualSwipeCount);
        if (verification) return verification;
        if (read.failed) {
          lastReadFailure = read;
        } else {
          pageComments = readComments;
          lastReadFailure = null;
          if (pageComments.length) break;
        }
        if (ocrAttempt < COMMENT_OCR_ATTEMPTS) {
          stage("RETRYING_COMMENT_OCR", {
            pageIndex: pageIndex, nextAttempt: ocrAttempt + 1,
            reasonCode: lastReadFailure ? "COMMENT_OCR_FAILED" : "COMMENT_OCR_EMPTY"
          });
          var retryWait = waitBetween(350, 650, "CAPTURING_COMMENTS", "COMMENT_OCR_FAILED", {
            control: control, pageIndex: pageIndex, swipeCount: actualSwipeCount,
            pages: pages, scope: scope
          });
          if (retryWait) return retryWait;
        }
      }
      if (lastReadFailure) {
        return failure("CAPTURING_COMMENTS", "COMMENT_OCR_FAILED",
          lastReadFailure.message || "评论区域 OCR 失败",
          { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pages, scope: scope });
      }
      pages.push({ pageIndex: pageIndex, comments: pageComments });
      var partial = candidates(pages, scope);
      var newCommentCount = Math.max(0, partial.length - knownCommentCount);
      knownCommentCount = partial.length;
      if (pageIndex > 0) {
        consecutiveNoNewPages = newCommentCount > 0 ? 0 : consecutiveNoNewPages + 1;
      }
      stage("COMMENT_PAGE_CAPTURED", {
        pageIndex: pageIndex, pageCount: pages.length, maxPageCount: maxSwipeCount + 1,
        swipeCount: actualSwipeCount, maxSwipeCount: maxSwipeCount,
        newCommentCount: newCommentCount, consecutiveNoNewPageCount: consecutiveNoNewPages,
        commentCount: partial.length, commentSourceCount: commentCapture.flattenPages(pages).length,
        captureCompleted: false, comments: partial
      });
      if (pageIndex > 0 && consecutiveNoNewPages >= MAX_CONSECUTIVE_NO_NEW_PAGES) {
        stoppedEarly = actualSwipeCount < maxSwipeCount;
        break;
      }
      if (actualSwipeCount >= maxSwipeCount) break;
      if (stopped(control)) return stoppedResult(pages, scope, actualSwipeCount);
      verification = verificationResult("SWIPING_COMMENTS", "before", {
        control: control, pageIndex: pageIndex, swipeIndex: actualSwipeCount + 1,
        swipeCount: actualSwipeCount, pages: pages, scope: scope
      });
      if (verification && verification.stopped) return stoppedResult(pages, scope, actualSwipeCount);
      if (verification) return verification;
      if (!actionAvailable("swipeComments")) {
        return failure("SWIPING_COMMENTS", "COMMENT_SWIPE_UNAVAILABLE",
          "评论区上滑能力不可用，脚本已停止",
          { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pages, scope: scope });
      }
      stage("SWIPING_COMMENTS", {
        swipeIndex: actualSwipeCount + 1, swipeCount: actualSwipeCount, maxSwipeCount: maxSwipeCount
      });
      var swipe = invoke("swipeComments", "SWIPING_COMMENTS", [], control);
      var completedSwipeCount = swipe.failed ? actualSwipeCount : actualSwipeCount + 1;
      if (swipe.stopped) return stoppedResult(pages, scope, swipe.completed ? completedSwipeCount : actualSwipeCount);
      verification = verificationResult("SWIPING_COMMENTS", "after", {
        control: control, pageIndex: pageIndex, swipeIndex: actualSwipeCount + 1,
        swipeCount: completedSwipeCount, pages: pages, scope: scope
      });
      if (verification && verification.stopped) return stoppedResult(pages, scope, completedSwipeCount);
      if (verification) return verification;
      if (swipe.failed) {
        return failure("SWIPING_COMMENTS", "COMMENT_SWIPE_FAILED",
          swipe.message || "评论区上滑失败",
          { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pages, scope: scope });
      }
      actualSwipeCount = completedSwipeCount;
      var swipeWait = waitBetween(700, 1200, "SWIPING_COMMENTS", "COMMENT_SWIPE_FAILED", {
        control: control, pageIndex: pageIndex, swipeCount: actualSwipeCount,
        pages: pages, scope: scope
      });
      if (swipeWait) return swipeWait;
    }
    var captured = candidates(pages, scope);
    if (!captured.length) {
      return failure("CAPTURING_COMMENTS", "COMMENT_OCR_EMPTY",
        "连续两个已翻页页面未识别到新增有效评论，脚本已停止", {
          pageIndex: pages.length ? pages[pages.length - 1].pageIndex : null,
          swipeCount: actualSwipeCount, pages: pages, scope: scope
        });
    }
    var sourceCount = commentCapture.flattenPages(pages).length;
    var stopReasonCode = stoppedEarly ? "NO_NEW_COMMENTS" : "SWIPE_LIMIT_REACHED";
    stage("COMMENTS_CAPTURED", {
      pageCount: pages.length, maxPageCount: maxSwipeCount + 1,
      swipeCount: actualSwipeCount, maxSwipeCount: maxSwipeCount,
      captureStopReason: stopReasonCode, commentCount: captured.length,
      commentSourceCount: sourceCount, captureStatus: "LIVE_COMMENT_ENTRY_CAPTURED",
      captureCompleted: true, comments: captured
    });
    return {
      status: "LIVE_COMMENT_ENTRY_ENTERED",
      captureStatus: "LIVE_COMMENT_ENTRY_CAPTURED",
      captureCompleted: true,
      commentSwipeCount: actualSwipeCount,
      commentPageCount: pages.length,
      captureStopReason: stopReasonCode,
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
