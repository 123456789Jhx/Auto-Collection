"use strict";
var defaultCommentCapture = require("./comment-capture.js");
var timingDefaults = require("./action-timing.js").DEFAULT_ACTIONS;
var COMMENT_OCR_ATTEMPTS = 3;
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
  var logger = options.logger || {};
  var now = options.now || Date.now;
  var deadline = Infinity;
  function expired() { return now() >= deadline; }
  function assign(target, source) { Object.keys(source || {}).forEach(function (key) { target[key] = source[key]; }); return target; }
  function cloneComments(comments) {
    return (comments || []).map(function (comment) {
      var clone = assign({}, comment);
      clone.sources = (comment.sources || []).map(function (source) { return assign({}, source); });
      return clone;
    });
  }
  function stage(name, payload) {
    var event = assign({}, payload);
    if (event.comments) event.comments = cloneComments(event.comments);
    if (typeof reportStage === "function") {
      event.stage = name;
      reportStage(event);
    } else if (typeof stageAlias === "function") stageAlias(name, event);
  }
  function log(level, message, details) {
    try { if (typeof logger[level] === "function") logger[level](message, details || {}); } catch (error) {}
  }
  function activeControl(control) { return control || defaultControl; }
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
  function stopReason(value) { return value &&
    (value.reason === "STOP_REQUESTED" || value.reasonCode === "STOP_REQUESTED"); }
  function normalizeAction(raw, failedStage, fromCaller) {
    if (raw && raw.stopped) return { stopped: true, value: raw.value };
    if (raw && raw.failed) {
      if (stopReason(raw) || stopReason(raw.value)) return { stopped: true, value: raw.value };
      return {
        failed: true,
        value: raw.value,
        reason: raw.reason || raw.reasonCode,
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
        reason: raw && (raw.reason || raw.reasonCode),
        message: String(raw && (raw.message || raw.stage || raw.reason) || failedStage)
      };
    }
    if (raw && raw.success === true) {
      return { value: raw.value, completedBeforeDeadline: raw.timingCompletedBeforeDeadline };
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
  function actionAvailable(name) { return typeof callAction === "function" || typeof runtime[name] === "function"; }
  function candidates(pages, scope) { return commentCapture.buildCandidates(pages, scope); }
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
      if (raw.reason !== "PLATFORM_VERIFICATION" && raw.reasonCode !== "PLATFORM_VERIFICATION") {
        return {
          failed: true,
          reasonCode: String(raw.reason || raw.reasonCode || "VERIFICATION_CHECK_FAILED"),
          message: String(raw.message || "平台验证检查失败")
        };
      }
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
      return stopped(details.control) ? { stopped: true } : failure(
        failedStage, "VERIFICATION_CHECK_FAILED",
        "平台验证检查失败: " + String(error && error.message || error), details);
    }
    if (stopped(details.control)) return { stopped: true };
    var detection = detectedValue(raw);
    if (!detection) return null;
    if (detection.stopped) return { stopped: true };
    if (detection.failed) {
      return failure(failedStage, detection.reasonCode, detection.message, details);
    }
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
    if (result.textSample === undefined) {
      result.textSample = String(detection.textSample || "").slice(0, 260);
    }
    result.verificationDiagnostics = { risk: detection.risk,
      pageStructure: detection.pageStructure, actionTrace: detection.actionTrace };
    result.pageIndex = details.pageIndex === undefined ? null : details.pageIndex;
    result.swipeCount = details.swipeCount === undefined ? 0 : details.swipeCount;
    result.pageCount = (details.pages || []).length;
    result.commentCount = partial.length;
    result.comments = partial;
    return result;
  }
  function rawCommentText(value) {
    if (typeof value === "string") return value;
    value = value || {}; return String(value.text || value.commentText || value.rawText || "");
  }
  function waitBetween(timingKey, timingSide, failedStage, reasonCode, details) {
    var fallback = timingDefaults[timingKey][timingSide === "before" ? "beforeMs" : "afterMs"];
    var min = fallback[0], max = fallback[1];
    var remaining = Math.max(0, deadline - now());
    if (!remaining) return null;
    min = Math.min(min, remaining); max = Math.min(max, remaining);
    if (timingKey && runtime.actionTiming && (typeof runtime.actionTiming.run === "function" ||
      typeof runtime.actionTiming.wait === "function")) {
      var timingDetails = { remainingMs: function () { return Math.max(0, deadline - now()); }, purpose: failedStage };
      var timed = typeof runtime.actionTiming.run === "function"
        ? runtime.actionTiming.run(timingKey, function () { return { success: true }; }, details.control, timingDetails)
        : runtime.actionTiming.wait(timingKey, details.control, timingDetails);
      if (timed && timed.stopped) return stoppedResult(details.pages, details.scope, details.swipeCount);
      if (timed && timed.success === false) return failure(failedStage, reasonCode, timed.message || timed.reason, details);
      return null;
    }
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
    var timed = options.captureDurationMinutes !== undefined;
    var minutes = Number(options.captureDurationMinutes);
    minutes = isFinite(minutes) && minutes >= 1 ? Math.min(60, Math.floor(minutes)) : 5;
    var captureStartedAt = now();
    deadline = timed ? captureStartedAt + minutes * 60000 : Infinity;
    var configuredMax = Number(options.maxSwipeCount);
    var maxSwipeCount = isFinite(configuredMax)
      ? Math.max(0, Math.min(20, Math.floor(configuredMax)))
      : Number(defaultCommentCapture.COMMENT_SWIPE_COUNT);
    var pages = [];
    var actualSwipeCount = 0;
    var stoppedEarly = false;
    captureLoop: for (var pageIndex = 0; timed || pageIndex <= maxSwipeCount; pageIndex += 1) {
      if (stopped(control)) return stoppedResult(pages, scope, actualSwipeCount);
      if (expired()) break;
      var pageComments = [];
      var lastReadFailure = null;
      for (var ocrAttempt = 1; ocrAttempt <= COMMENT_OCR_ATTEMPTS; ocrAttempt += 1) {
        var pendingPages = pageComments.length ? pages.concat([{ pageIndex: pageIndex, comments: pageComments }]) : pages;
        if (expired()) break captureLoop;
        var verification = verificationResult("CAPTURING_COMMENTS", "before", {
          control: control, pageIndex: pageIndex, ocrAttempt: ocrAttempt,
          swipeCount: actualSwipeCount, pages: pendingPages, scope: scope
        });
        if (verification && verification.stopped) return stoppedResult(pendingPages, scope, actualSwipeCount);
        if (verification) return verification;
        if (expired()) break captureLoop;
        if (!actionAvailable("readComments")) {
          return failure("CAPTURING_COMMENTS", "COMMENT_OCR_UNAVAILABLE",
            "评论区域 OCR 能力不可用，脚本已停止",
            { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pages, scope: scope });
        }
        stage("CAPTURING_COMMENTS", {
          pageIndex: pageIndex, pageCount: pages.length + 1, maxPageCount: null,
          swipeCount: actualSwipeCount, maxSwipeCount: null, ocrAttempt: ocrAttempt
        });
        if (expired()) break captureLoop;
        var read = invoke("readComments", "CAPTURING_COMMENTS", [{
          remainingMs: function () { return Math.max(0, deadline - now()); }
        }], control);
        if (expired() && !read.stopped && read.completedBeforeDeadline !== true) break captureLoop;
        var readComments = [];
        if (!read.failed && (!read.stopped || read.completed)) {
          try {
            readComments = commentCapture.parseFilteredCommentLines(rawCommentText(read.value));
          } catch (error) {
            read = { failed: true, message: String(error && error.message || error) };
          }
        }
        log(read.failed ? "warn" : "info", "抓取评论词评论 OCR 识别状态", {
          pageIndex: pageIndex, ocrAttempt: ocrAttempt, failed: !!read.failed,
          rawTextRecognized: !read.failed && !!String(rawCommentText(read.value) || "").trim(),
          parsedCommentCount: readComments.length, message: read.message || ""
        });
        if (read.stopped) {
          if (read.completed && !read.failed && readComments.length) pages.push({ pageIndex: pageIndex, comments: readComments });
          return stoppedResult(read.completed && !read.failed && readComments.length ? pages : pendingPages, scope, actualSwipeCount);
        }
        if (expired()) {
          if (read.failed) {
            lastReadFailure = read.reason === "TIMING_DEADLINE_REACHED" ? null : read;
          } else {
            if (readComments.length) pageComments = readComments;
            lastReadFailure = null;
          }
          break;
        }
        var verificationPages = readComments.length
          ? pages.concat([{ pageIndex: pageIndex, comments: readComments }])
          : pendingPages;
        verification = verificationResult("CAPTURING_COMMENTS", "after", {
          control: control, pageIndex: pageIndex, ocrAttempt: ocrAttempt,
          swipeCount: actualSwipeCount, pages: verificationPages, scope: scope
        });
        if (verification && verification.stopped) return stoppedResult(verificationPages, scope, actualSwipeCount);
        if (verification) return verification;
        if (expired()) break captureLoop;
        if (read.failed) {
          lastReadFailure = read;
        } else {
          if (readComments.length) pageComments = readComments;
          lastReadFailure = null;
          if (readComments.length) break;
        }
        if (ocrAttempt < COMMENT_OCR_ATTEMPTS) {
          stage("RETRYING_COMMENT_OCR", {
            pageIndex: pageIndex, nextAttempt: ocrAttempt + 1,
            reasonCode: lastReadFailure ? "COMMENT_OCR_FAILED" : "COMMENT_OCR_EMPTY"
          });
          var retryWait = waitBetween("commentOcrRetry", "before", "CAPTURING_COMMENTS", "COMMENT_OCR_FAILED", {
            control: control, pageIndex: pageIndex, swipeCount: actualSwipeCount,
            pages: pageComments.length ? verificationPages : pendingPages, scope: scope
          });
          if (retryWait) return retryWait;
        }
      }
      if (lastReadFailure) {
        return failure("CAPTURING_COMMENTS", "COMMENT_OCR_FAILED",
          lastReadFailure.message || "评论区域 OCR 失败",
          { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pendingPages, scope: scope });
      }
      pages.push({ pageIndex: pageIndex, comments: pageComments });
      var partial = candidates(pages, scope);
      stage("COMMENT_PAGE_CAPTURED", {
        pageIndex: pageIndex, pageCount: pages.length, maxPageCount: null,
        swipeCount: actualSwipeCount, maxSwipeCount: null,
        commentCount: partial.length, commentSourceCount: commentCapture.flattenPages(pages).length,
        captureCompleted: false, comments: partial
      });
      if (expired() || !timed && actualSwipeCount >= maxSwipeCount) break;
      if (stopped(control)) return stoppedResult(pages, scope, actualSwipeCount);
      verification = verificationResult("SWIPING_COMMENTS", "before", {
        control: control, pageIndex: pageIndex, swipeIndex: actualSwipeCount + 1,
        swipeCount: actualSwipeCount, pages: pages, scope: scope
      });
      if (verification && verification.stopped) return stoppedResult(pages, scope, actualSwipeCount);
      if (verification) return verification;
      if (expired()) break;
      if (!actionAvailable("swipeComments")) {
        return failure("SWIPING_COMMENTS", "COMMENT_SWIPE_UNAVAILABLE",
          "评论区下滑并保持能力不可用，脚本已停止",
          { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pages, scope: scope });
      }
      stage("SWIPING_COMMENTS", {
        swipeIndex: actualSwipeCount + 1, swipeCount: actualSwipeCount, maxSwipeCount: timed ? null : maxSwipeCount
      });
      log("info", "抓取评论词评论区滑动开始", { swipeIndex: actualSwipeCount + 1, swipeCount: actualSwipeCount, maxSwipeCount: timed ? null : maxSwipeCount, captureDurationMinutes: timed ? minutes : null, remainingMs: timed ? Math.max(0, deadline - now()) : null });
      if (expired()) break;
      var swipe = invoke("swipeComments", "SWIPING_COMMENTS", [{
        remainingMs: function () { return Math.max(0, deadline - now()); }
      }], control);
      if (swipe.failed && swipe.reason === "TIMING_DEADLINE_REACHED" && expired()) break;
      var completedSwipeCount = swipe.failed ? actualSwipeCount : actualSwipeCount + 1;
      if (swipe.stopped) return stoppedResult(pages, scope, swipe.completed ? completedSwipeCount : actualSwipeCount);
      if (expired() && !swipe.failed) { actualSwipeCount = completedSwipeCount; break; }
      verification = verificationResult("SWIPING_COMMENTS", "after", {
        control: control, pageIndex: pageIndex, swipeIndex: actualSwipeCount + 1,
        swipeCount: completedSwipeCount, pages: pages, scope: scope
      });
      if (verification && verification.stopped) return stoppedResult(pages, scope, completedSwipeCount);
      if (verification) return verification;
      if (expired() && !swipe.failed) { actualSwipeCount = completedSwipeCount; break; }
      if (swipe.failed) {
        return failure("SWIPING_COMMENTS", "COMMENT_SWIPE_FAILED",
          swipe.message || "评论区下滑并检查到底提示失败",
          { pageIndex: pageIndex, swipeCount: actualSwipeCount, pages: pages, scope: scope });
      }
      log("info", "抓取评论词评论区滑动完成", { swipeIndex: completedSwipeCount, success: !swipe.failed, swipeCount: completedSwipeCount });
      actualSwipeCount = completedSwipeCount;
      if (swipe.value && swipe.value.endDetected === true) {
        stoppedEarly = true;
        log("info", "检测到没有更多信息了，结束当前直播间抓取", {
          captureStopReason: "COMMENT_HISTORY_END", swipeCount: actualSwipeCount,
          text: String(swipe.value.text || ""), commentCount: partial.length
        });
        break;
      }
      if (!runtime.actionTiming) {
        var swipeWait = waitBetween("swipeComments", "after", "SWIPING_COMMENTS", "COMMENT_SWIPE_FAILED", {
          control: control, pageIndex: pageIndex, swipeCount: actualSwipeCount,
          pages: pages, scope: scope
        });
        if (swipeWait) return swipeWait;
      }
    }
    var captured = candidates(pages, scope);
    if (!timed && !captured.length && !stoppedEarly) {
      return failure("CAPTURING_COMMENTS", "COMMENT_OCR_EMPTY",
        "评论采集未识别到有效评论，脚本已停止", {
          pageIndex: pages.length ? pages[pages.length - 1].pageIndex : null,
          swipeCount: actualSwipeCount, pages: pages, scope: scope
        });
    }
    var sourceCount = commentCapture.flattenPages(pages).length;
    var stopReasonCode = stoppedEarly ? "COMMENT_HISTORY_END" : timed ? "DURATION_REACHED" : "SWIPE_LIMIT_REACHED";
    var captureElapsedMs = Math.max(0, now() - captureStartedAt);
    log("info", "直播间评论抓取结束", { roomKey: scope.roomKey, captureStopReason: stopReasonCode,
      captureDurationMinutes: timed ? minutes : null, captureElapsedMs: captureElapsedMs,
      swipeCount: actualSwipeCount, rawCommentCount: captured.length });
    stage("COMMENTS_CAPTURED", {
      pageCount: pages.length, maxPageCount: timed ? null : maxSwipeCount + 1,
      swipeCount: actualSwipeCount, maxSwipeCount: timed ? null : maxSwipeCount,
      captureStopReason: stopReasonCode, commentCount: captured.length,
      commentSourceCount: sourceCount, captureStatus: "LIVE_COMMENT_ENTRY_CAPTURED",
      captureCompleted: true, comments: captured
    });
    return {
      status: "LIVE_COMMENT_ENTRY_ENTERED",
      captureStatus: "LIVE_COMMENT_ENTRY_CAPTURED",
      captureCompleted: true,
      captureElapsedMs: captureElapsedMs,
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
  createCommentCaptureRunner: createCommentCaptureRunner
};
