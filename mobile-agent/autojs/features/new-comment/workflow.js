"use strict";

var defaultRunnerModule = require("./comment-runner.js");
var defaultCommentCapture = require("./comment-capture.js");

function createIsolatedLiveCommentWorkflow(options) {
  options = options || {};
  var context = options.context || {};
  var runtime = options.runtime || {};
  var reportStage = options.reportStage || function () {};
  var finalCleanup = options.finalCleanup;

  function stopped(control) {
    try { return !!(control && typeof control.shouldStop === "function" && control.shouldStop()); }
    catch (error) { return true; }
  }

  function stage(name, payload) {
    var event = payload || {};
    event.stage = name;
    reportStage(event);
  }

  function failure(failedStage, message, reasonCode, diagnostics) {
    var event = { failedStage: failedStage, message: message };
    if (reasonCode) event.reasonCode = reasonCode;
    if (diagnostics) event.verificationDiagnostics = diagnostics;
    stage("FAILED", event);
    var result = { status: "LIVE_COMMENT_ENTRY_FAILED", failedStage: failedStage, message: message };
    if (reasonCode) result.reasonCode = reasonCode;
    if (diagnostics) { result.verificationDiagnostics = diagnostics; result.cleanupRequired = true; }
    return result;
  }

  function diagnosticsOf(value) {
    value = value || {};
    var diagnostics = { risk: value.risk, pageStructure: value.pageStructure, actionTrace: value.actionTrace };
    if (value.visibleStructure !== undefined) diagnostics.visibleStructure = value.visibleStructure;
    return diagnostics;
  }

  function platformFailure(failedStage, detection, details) {
    detection = detection || {};
    details = details || {};
    var diagnostics = diagnosticsOf(detection);
    var event = { failedStage: failedStage, message: "出现平台验证", phase: details.phase,
      pageIndex: details.pageIndex, ocrAttempt: details.ocrAttempt, swipeIndex: details.swipeIndex,
      commentCount: details.commentCount, textSample: String(detection.textSample || "").slice(0, 260),
      verificationDiagnostics: diagnostics };
    if (!details.capturePhase) event.reasonCode = "PLATFORM_VERIFICATION";
    stage("PLATFORM_VERIFICATION", event);
    var result = { status: "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION", reasonCode: "PLATFORM_VERIFICATION",
      message: "出现平台验证", failedStage: failedStage, cleanupRequired: true,
      textSample: event.textSample, verificationDiagnostics: diagnostics };
    if (details.capturePhase) {
      result.platformVerification = true;
      result.capturePlatformVerification = true;
    }
    return result;
  }

  function normalizeDetection(raw) {
    if (!raw) return null;
    if (raw.success === true) raw = raw.value;
    if (!raw) return null;
    if (raw.success === false) {
      if (raw.reason === "STOP_REQUESTED") return { stopped: true };
      if (raw.reason !== "PLATFORM_VERIFICATION" && raw.reasonCode !== "PLATFORM_VERIFICATION") return raw;
      var detected = {};
      Object.keys(raw.details || {}).forEach(function (key) { detected[key] = raw.details[key]; });
      detected.detected = true;
      detected.reasonCode = "PLATFORM_VERIFICATION";
      detected.textSample = String(detected.textSample || raw.textSample || "");
      return detected;
    }
    if (raw.detected === true || raw.platformVerification === true ||
        raw.reason === "PLATFORM_VERIFICATION" || raw.reasonCode === "PLATFORM_VERIFICATION") return raw;
    return null;
  }

  function detectRaw(stageName, control, details) {
    if (stopped(control)) return { success: false, reason: "STOP_REQUESTED" };
    if (typeof runtime.detectPlatformVerification !== "function") return null;
    var raw;
    try { raw = runtime.detectPlatformVerification(stageName, details || {}); }
    catch (error) {
      return { success: false, reason: "VERIFICATION_CHECK_FAILED",
        message: "平台验证检查失败: " + String(error && error.message || error) };
    }
    return stopped(control) ? { success: false, reason: "STOP_REQUESTED" } : raw;
  }

  function verification(stageName, control, details) {
    var normalized = normalizeDetection(detectRaw(stageName, control, details));
    if (!normalized) return null;
    if (normalized.stopped || normalized.reason === "STOP_REQUESTED") return { status: "STOPPED" };
    if (normalized.success === false) {
      return failure(stageName, String(normalized.message || "平台验证检查失败"),
        String(normalized.reason || normalized.reasonCode || "VERIFICATION_CHECK_FAILED"),
        diagnosticsOf(normalized.details || normalized));
    }
    return platformFailure(stageName, normalized, details);
  }

  function call(name, failedStage, args, control) {
    if (stopped(control)) return { stopped: true };
    if (typeof runtime[name] !== "function") return { failed: true, message: name + " unavailable" };
    var raw;
    try { raw = runtime[name].apply(runtime, args || []); }
    catch (error) { return stopped(control) ? { stopped: true } :
      { failed: true, message: String(error && error.message || error) }; }
    if (stopped(control) || raw && (raw.stopped || raw.reason === "STOP_REQUESTED")) return { stopped: true };
    if (raw && raw.success === true) return { value: raw.value };
    if (raw === false || raw && raw.success === false) return { failed: true, value: raw,
      message: String(raw && (raw.message || raw.stage || raw.reason) || failedStage) };
    return { value: raw };
  }

  function wait(min, max, stageName, control) {
    if (typeof runtime.waitRandom !== "function") return stopped(control) ? { stopped: true } : {};
    return call("waitRandom", stageName, [min, max], control);
  }

  function viewerFailure(status, reasonCode, message, failedStage, details) {
    details = details || {};
    stage("FAILED", { failedStage: failedStage, reasonCode: reasonCode, message: message });
    return { status: status, reasonCode: reasonCode, message: message, failedStage: failedStage,
      cleanupRequired: true, viewerCount: details.viewerCount === undefined ? null : details.viewerCount,
      minViewerCount: details.minViewerCount === undefined ? null : details.minViewerCount,
      viewerCountSource: String(details.viewerCountSource || "none"),
      textSample: String(details.textSample || "").slice(0, 260) };
  }

  function viewerThreshold(payload, control) {
    var configured = Number(payload.minViewerCount);
    var minimum = isFinite(configured) && configured > 0 ? Math.floor(configured) : 0;
    if (typeof runtime.readViewerCount !== "function") return null;
    var floorEnabled = minimum > 0;
    var requestedRooms = Math.floor(Number(payload.maxCandidateRooms || 20));
    var maxRooms = Math.max(1, Math.min(20, isFinite(requestedRooms) ? requestedRooms : 20));
    var candidate;
    for (candidate = 1; candidate <= maxRooms; candidate += 1) {
      var accepted = null;
      var ended = null;
      var last = null;
      var attempt;
      for (attempt = 1; attempt <= 3; attempt += 1) {
        if (stopped(control)) return { status: "STOPPED" };
        stage("CHECKING_VIEWER_COUNT", { candidateIndex: candidate, attempt: attempt, minViewerCount: minimum });
        var read = call("readViewerCount", "CHECKING_VIEWER_COUNT", [], control);
        if (read.stopped) return { status: "STOPPED" };
        if (read.value) last = read.value;
        if (!read.failed && read.value && read.value.ended === true) { ended = read.value; break; }
        if (!read.failed && read.value && read.value.count !== null && read.value.count !== undefined &&
            isFinite(Number(read.value.count))) { accepted = read.value; break; }
        if (attempt < 3) {
          var retryWait = wait(500, 900, "CHECKING_VIEWER_COUNT", control);
          if (retryWait.stopped) return { status: "STOPPED" };
        }
      }
      if (ended) {
        stage("SKIPPING_ENDED_LIVE_ROOM", { candidateIndex: candidate,
          textSample: String(ended.endedTextSample || ended.textSample || "").slice(0, 260) });
        if (candidate >= maxRooms) return viewerFailure("LIVE_COMMENT_ENTRY_LIVE_ENDED_EXHAUSTED",
          "LIVE_ROOM_ENDED", "连续直播间均已结束，脚本已停止", "SKIPPING_ENDED_LIVE_ROOM",
          { minViewerCount: minimum, viewerCountSource: ended.source,
            textSample: ended.endedTextSample || ended.textSample });
        var endedNext = call("nextLive", "SKIPPING_ENDED_LIVE_ROOM", [], control);
        if (endedNext.stopped) return { status: "STOPPED" };
        if (endedNext.failed) return viewerFailure("LIVE_COMMENT_ENTRY_LIVE_ENDED_SKIP_FAILED",
          "NEXT_LIVE_ROOM_FAILED", "直播已结束后切换下一个直播间失败，脚本已停止",
          "SKIPPING_ENDED_LIVE_ROOM", { minViewerCount: minimum,
            textSample: ended.endedTextSample || ended.textSample });
        if (wait(1000, 2000, "SKIPPING_ENDED_LIVE_ROOM", control).stopped) return { status: "STOPPED" };
        var endedVerification = verification("SKIPPING_ENDED_LIVE_ROOM", control);
        if (endedVerification) return endedVerification;
        continue;
      }
      if (!accepted) {
        if (!floorEnabled) return null;
        return viewerFailure("LIVE_COMMENT_ENTRY_VIEWER_COUNT_FAILED", "VIEWER_COUNT_READ_FAILED",
          "无法识别直播间人数，脚本已停止", "CHECKING_VIEWER_COUNT", { minViewerCount: minimum,
            viewerCountSource: last && last.source, textSample: last && last.textSample });
      }
      var viewerCount = Number(accepted.count);
      if (!floorEnabled || viewerCount >= minimum) {
        stage("VIEWER_COUNT_ACCEPTED", { candidateIndex: candidate, viewerCount: viewerCount,
          minViewerCount: minimum });
        return { viewerCount: viewerCount, minViewerCount: minimum, candidateIndex: candidate };
      }
      if (candidate >= maxRooms) return viewerFailure("LIVE_COMMENT_ENTRY_VIEWER_THRESHOLD_EXHAUSTED",
        "VIEWER_THRESHOLD_NOT_MET", "连续直播间人数均未达到下限，脚本已停止", "CHECKING_VIEWER_COUNT",
        { viewerCount: viewerCount, minViewerCount: minimum, viewerCountSource: accepted.source,
          textSample: accepted.textSample });
      stage("SKIPPING_LOW_VIEWER_ROOM", { candidateIndex: candidate, viewerCount: viewerCount,
        minViewerCount: minimum });
      var next = call("nextLive", "SKIPPING_LOW_VIEWER_ROOM", [], control);
      if (next.stopped) return { status: "STOPPED" };
      if (next.failed) return viewerFailure("LIVE_COMMENT_ENTRY_VIEWER_THRESHOLD_FAILED",
        "NEXT_LIVE_ROOM_FAILED", "人数不足后切换下一个直播间失败，脚本已停止",
        "SKIPPING_LOW_VIEWER_ROOM", { viewerCount: viewerCount, minViewerCount: minimum });
      if (wait(1000, 2000, "SKIPPING_LOW_VIEWER_ROOM", control).stopped) return { status: "STOPPED" };
      var foundVerification = verification("CHECKING_VIEWER_COUNT", control);
      if (foundVerification) return foundVerification;
    }
    return null;
  }

  var runner = options.commentRunner;
  if (!runner || typeof runner.capture !== "function") {
    var runnerModule = runner && typeof runner.createCommentCaptureRunner === "function" ? runner :
      (options.commentRunnerModule || defaultRunnerModule);
    runner = runnerModule.createCommentCaptureRunner({ runtime: runtime,
      commentCapture: options.commentCapture || defaultCommentCapture, stage: stage, call: call,
      stopped: stopped, detectPlatformVerification: detectRaw,
      platformVerificationFailure: platformFailure });
  }

  function captureScope(payload, candidateIndex) {
    var configuredDevice = context.config && context.config.device || {};
    var keyword = String(payload.targetKeyword || payload.keyword || "").trim().toLowerCase();
    return { batchId: String(payload.batchId || ""),
      deviceId: String(payload.deviceId || options.deviceId || configuredDevice.deviceId || ""),
      roomKey: String(payload.roomKey || "live-comment:" + keyword + ":candidate:" + (candidateIndex || 1)) };
  }

  function cleanupSucceeded(cleanup) {
    if (!cleanup || cleanup.completed !== true || cleanup.fallback === "HOME") return false;
    var reason = String(cleanup.cleanupReason || cleanup.reason || "");
    return reason !== "RECENTS_UNAVAILABLE" && reason !== "DOUYIN_RECENTS_CARD_NOT_FOUND" &&
      reason !== "DOUYIN_RECENTS_DISMISS_FAILED";
  }

  function finish(payload, viewerResult, control) {
    var result = runner.capture(captureScope(payload, viewerResult && viewerResult.candidateIndex), control) ||
      { status: "LIVE_COMMENT_ENTRY_ENTERED" };
    if (result.status === "STOPPED") return result;
    if (stopped(control)) return { status: "STOPPED" };
    if (viewerResult) { result.viewerCount = viewerResult.viewerCount; result.minViewerCount = viewerResult.minViewerCount; }
    if (finalCleanup && typeof finalCleanup.run === "function") {
      stage("CLEANING_UP", { commentCount: Number(result.commentCount || 0) });
      var cleanup;
      try { cleanup = finalCleanup.run({ taskId: String(payload.batchId || "") }, {
        beforeReturnToAgent: function () { stage("RETURNING_TO_AGENT", { commentCount: Number(result.commentCount || 0) }); }
      }); } catch (error) {
        cleanup = { completed: false, reason: "LIVE_COMMENT_ENTRY_CLEANUP_FAILED", message: String(error) };
      }
      result.cleanup = cleanup || { completed: false, reason: "LIVE_COMMENT_ENTRY_CLEANUP_EMPTY_RESULT" };
      result.cleanupAttempted = true;
      if (cleanupSucceeded(result.cleanup)) stage("CLEANUP_COMPLETED", { commentCount: Number(result.commentCount || 0) });
      else {
        result.cleanupFailed = true;
        if (result.status === "LIVE_COMMENT_ENTRY_ENTERED") {
          result.captureStatus = result.captureStatus || result.status;
          result.status = "LIVE_COMMENT_ENTRY_CLEANUP_FAILED";
          result.failedStage = "CLEANING_UP";
          result.reasonCode = "LIVE_COMMENT_ENTRY_CLEANUP_FAILED";
          result.message = "评论抓取完成，但退出抖音并返回燎原星火失败";
        }
      }
    }
    if (result.capturePlatformVerification === true && result.cleanupAttempted === true) {
      result.status = "LIVE_COMMENT_ENTRY_CAPTURE_PLATFORM_VERIFICATION";
      result.reasonCode = "CAPTURE_PLATFORM_VERIFICATION";
      result.platformVerification = true;
      result.cleanupRequired = false;
      delete result.capturePlatformVerification;
    }
    if (result.status !== "LIVE_COMMENT_ENTRY_ENTERED") stage("FAILED", { failedStage: result.failedStage || "CLEANING_UP",
      reasonCode: result.reasonCode, message: result.message, commentCount: Number(result.commentCount || 0),
      verificationDiagnostics: result.verificationDiagnostics });
    return result;
  }

  function noResult(value) {
    return value === false || !!(value && (value.reason === "NO_RESULT" || value.noResult === true ||
      value.stage === "result_wait"));
  }

  function run(payload, control) {
    payload = payload || {};
    control = control || {};
    if (stopped(control)) return { status: "STOPPED" };
    var keyword = String(payload.targetKeyword || payload.keyword || "").trim();
    stage("OPENING_DOUYIN", { attempt: 1 });
    var result = call("openDouyin", "OPENING_DOUYIN", [], control);
    if (result.stopped) return { status: "STOPPED" };
    var checked = verification("OPENING_DOUYIN", control);
    if (checked) return checked;
    if (result.failed) return failure("OPENING_DOUYIN", result.message);
    if (wait(7000, 7000, "OPENING_DOUYIN", control).stopped) return { status: "STOPPED" };
    var attempt;
    for (attempt = 1; attempt <= 2; attempt += 1) {
      stage("OPENING_SEARCH", { attempt: attempt });
      stage("INPUT_KEYWORD", { attempt: attempt, keyword: keyword });
      result = call(attempt === 1 ? "openSearch" : "restartSearch", "OPENING_SEARCH", [keyword, control], control);
      if (result.stopped) return { status: "STOPPED" };
      checked = verification("OPENING_SEARCH", control);
      if (checked) return checked;
      if (result.failed) {
        if (attempt === 1 && result.value && result.value.stage === "result_wait") {
          stage("RETRYING_SEARCH", { attempt: 2, message: result.message });
          continue;
        }
        return failure("OPENING_SEARCH", result.message);
      }
      if (wait(300, 900, "OPENING_SEARCH", control).stopped) return { status: "STOPPED" };
      stage("OPENING_LIVE_TAB", { attempt: attempt });
      result = call("openLiveTab", "OPENING_LIVE_TAB", [], control);
      if (result.stopped) return { status: "STOPPED" };
      checked = verification("OPENING_LIVE_TAB", control);
      if (checked) return checked;
      if (result.failed) return failure("OPENING_LIVE_TAB", result.message);
      if (wait(1000, 3000, "OPENING_LIVE_TAB", control).stopped) return { status: "STOPPED" };
      stage("OPENING_FIRST_RESULT", { attempt: attempt });
      result = call("openFirstLive", "OPENING_FIRST_RESULT", [], control);
      if (result.stopped) return { status: "STOPPED" };
      checked = verification("OPENING_FIRST_RESULT", control);
      if (checked) return checked;
      if (result.failed) {
        if (attempt >= 2 || !noResult(result.value)) return failure("OPENING_FIRST_RESULT", result.message);
        stage("RETRYING_SEARCH", { attempt: 2, message: result.message });
        continue;
      }
      if (wait(1000, 3000, "OPENING_FIRST_RESULT", control).stopped) return { status: "STOPPED" };
      var viewer = viewerThreshold(payload, control);
      if (viewer && viewer.status) return viewer;
      var ready = false;
      var confirmation;
      for (confirmation = 1; confirmation <= 3; confirmation += 1) {
        result = call("isLiveRoom", "OPENING_FIRST_RESULT", [], control);
        if (result.stopped) return { status: "STOPPED" };
        checked = verification("OPENING_FIRST_RESULT", control);
        if (checked) return checked;
        if (!result.failed && result.value) { ready = true; break; }
        if (confirmation < 3 && wait(600, 900, "OPENING_FIRST_RESULT", control).stopped) return { status: "STOPPED" };
      }
      if (!ready) return failure("OPENING_FIRST_RESULT", result.message || "LIVE_ROOM_NOT_READY");
      stage("ENTERED", { attempt: attempt, viewerCount: viewer && viewer.viewerCount });
      return finish(payload, viewer, control);
    }
    return failure("OPENING_FIRST_RESULT", "LIVE_ENTRY_NOT_FOUND");
  }

  return { run: run };
}

module.exports = { createIsolatedLiveCommentWorkflow: createIsolatedLiveCommentWorkflow };
