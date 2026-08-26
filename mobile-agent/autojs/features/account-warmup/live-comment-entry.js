// 职责：进入抖音直播间并采集评论；不调用互动 runner 或词库写入。
function loadLiveCommentDependency(context, path, fallback) {
  if (context && context.forceBaselineLiveCommentEntry && typeof context.loadBaselineScript === "function") {
    return context.loadBaselineScript(path);
  }
  if (context && typeof context.loadBizScript === "function") {
    return context.loadBizScript(path);
  }
  return fallback();
}

function createLiveCommentEntryTask(options) {
  options = options || {};
  var context = options.context || {};
  var runtimeAdapter = options.runtimeAdapter || loadLiveCommentDependency(context,
    "features/account-warmup/live-comment-entry-runtime.js",
    function () { return require("./live-comment-entry-runtime.js"); });
  var captureRunnerModule = options.captureRunnerModule || loadLiveCommentDependency(context,
    "features/account-warmup/live-comment-entry-comment-runner.js",
    function () { return require("./live-comment-entry-comment-runner.js"); });
  var runtime = options.runtime || runtimeAdapter.createDefaultRuntime(context, options.fastSearch, {
    gestureMode: options.gestureMode
  });
  var finalCleanup = options.finalCleanup;
  var reportStage = options.reportStage || function () {};

  function stopped(control) {
    return !!(control && control.shouldStop && control.shouldStop());
  }

  function stage(stageName, payload) {
    var event = payload || {};
    event.stage = stageName;
    reportStage(event);
  }

  function failure(failedStage, message) {
    stage("FAILED", { failedStage: failedStage, message: message });
    return { status: "LIVE_COMMENT_ENTRY_FAILED", failedStage: failedStage, message: message };
  }

  function platformVerificationFailure(failedStage, detection, details) {
    detection = detection || {};
    details = details || {};
    var capturePhase = details.capturePhase === true;
    stage("PLATFORM_VERIFICATION", {
      failedStage: failedStage,
      reasonCode: capturePhase ? undefined : "PLATFORM_VERIFICATION",
      message: "出现平台验证",
      phase: details.phase,
      pageIndex: details.pageIndex,
      ocrAttempt: details.ocrAttempt,
      swipeIndex: details.swipeIndex,
      commentCount: details.commentCount,
      textSample: String(detection.textSample || "").slice(0, 260)
    });
    var result = {
      status: "LIVE_COMMENT_ENTRY_PLATFORM_VERIFICATION",
      reasonCode: "PLATFORM_VERIFICATION",
      message: "出现平台验证",
      failedStage: failedStage,
      cleanupRequired: true,
      textSample: String(detection.textSample || "").slice(0, 260)
    };
    if (capturePhase) {
      result.platformVerification = true;
      result.capturePlatformVerification = true;
    }
    return result;
  }

  function detectPlatformVerification(stageName, control, details) {
    if (stopped(control) || !runtime.detectPlatformVerification) return null;
    try {
      var detection = runtime.detectPlatformVerification(stageName, details || {});
      return detection && detection.detected ? detection : null;
    } catch (error) {
      return null;
    }
  }

  function call(name, failedStage, args, control) {
    if (stopped(control)) return { stopped: true };
    var result;
    try {
      result = runtime[name].apply(runtime, args || []);
    } catch (error) {
      return { failed: true, message: String(error && error.message || error) };
    }
    if (result && result.stopped) return { stopped: true };
    if (result === false || (result && result.success === false)) {
      return {
        failed: true,
        value: result,
        message: String(result && (result.message || result.stage || result.reason) || failedStage)
      };
    }
    return { value: result };
  }

  function viewerFailure(status, reasonCode, message, failedStage, details) {
    details = details || {};
    stage("FAILED", { failedStage: failedStage, reasonCode: reasonCode, message: message });
    return {
      status: status,
      reasonCode: reasonCode,
      message: message,
      failedStage: failedStage,
      cleanupRequired: true,
      viewerCount: details.viewerCount === undefined ? null : details.viewerCount,
      minViewerCount: details.minViewerCount === undefined ? null : details.minViewerCount,
      viewerCountSource: String(details.viewerCountSource || "none"),
      textSample: String(details.textSample || "").slice(0, 260)
    };
  }

  function viewerThreshold(payload, control) {
    var configuredMinimum = Number(payload.minViewerCount);
    var minViewerCount = isFinite(configuredMinimum) && configuredMinimum > 0 ? Math.floor(configuredMinimum) : 0;
    if (!runtime.readViewerCount) return null;
    var floorEnabled = minViewerCount > 0;
    var maxRooms = Math.max(1, Math.min(100, Math.floor(Number(payload.maxCandidateRooms || 20))));

    for (var candidateIndex = 1; candidateIndex <= maxRooms; candidateIndex++) {
      var read = null;
      var lastRead = null;
      var endedRead = null;
      for (var attempt = 1; attempt <= 3; attempt++) {
        if (stopped(control)) return { status: "STOPPED" };
        stage("CHECKING_VIEWER_COUNT", {
          candidateIndex: candidateIndex,
          attempt: attempt,
          minViewerCount: minViewerCount
        });
        var readResult = call("readViewerCount", "CHECKING_VIEWER_COUNT", [], control);
        if (readResult.stopped) return { status: "STOPPED" };
        if (readResult.value) lastRead = readResult.value;
        if (!readResult.failed && readResult.value && readResult.value.ended === true) {
          endedRead = readResult.value;
          break;
        }
        if (!readResult.failed && readResult.value && readResult.value.count !== null &&
          readResult.value.count !== undefined && isFinite(Number(readResult.value.count))) {
          read = readResult.value;
          break;
        }
        if (attempt < 3 && runtime.waitRandom) runtime.waitRandom(500, 900);
      }

      if (endedRead) {
        stage("SKIPPING_ENDED_LIVE_ROOM", {
          candidateIndex: candidateIndex,
          textSample: String(endedRead.endedTextSample || endedRead.textSample || "").slice(0, 260)
        });
        if (candidateIndex >= maxRooms) {
          return viewerFailure("LIVE_COMMENT_ENTRY_LIVE_ENDED_EXHAUSTED", "LIVE_ROOM_ENDED",
            "连续直播间均已结束，脚本已停止", "SKIPPING_ENDED_LIVE_ROOM", {
              minViewerCount: minViewerCount,
              viewerCountSource: endedRead.source,
              textSample: endedRead.endedTextSample || endedRead.textSample
            });
        }
        var endedNext = call("nextLive", "SKIPPING_ENDED_LIVE_ROOM", [], control);
        if (endedNext.stopped) return { status: "STOPPED" };
        if (endedNext.failed) {
          return viewerFailure("LIVE_COMMENT_ENTRY_LIVE_ENDED_SKIP_FAILED", "NEXT_LIVE_ROOM_FAILED",
            "直播已结束后切换下一个直播间失败，脚本已停止", "SKIPPING_ENDED_LIVE_ROOM", {
              minViewerCount: minViewerCount,
              textSample: endedRead.endedTextSample || endedRead.textSample
            });
        }
        if (runtime.waitRandom) runtime.waitRandom(1000, 2000);
        var endedVerification = detectPlatformVerification("SKIPPING_ENDED_LIVE_ROOM", control);
        if (endedVerification) return platformVerificationFailure("SKIPPING_ENDED_LIVE_ROOM", endedVerification);
        continue;
      }

      if (!read) {
        if (!floorEnabled) return null;
        return viewerFailure("LIVE_COMMENT_ENTRY_VIEWER_COUNT_FAILED", "VIEWER_COUNT_READ_FAILED",
          "无法识别直播间人数，脚本已停止", "CHECKING_VIEWER_COUNT", {
            minViewerCount: minViewerCount,
            viewerCountSource: lastRead && lastRead.source,
            textSample: lastRead && lastRead.textSample
          });
      }

      var viewerCount = Number(read.count);
      if (!floorEnabled || viewerCount >= minViewerCount) {
        stage("VIEWER_COUNT_ACCEPTED", {
          candidateIndex: candidateIndex,
          viewerCount: viewerCount,
          minViewerCount: minViewerCount
        });
        return { viewerCount: viewerCount, minViewerCount: minViewerCount, candidateIndex: candidateIndex };
      }
      if (candidateIndex >= maxRooms) {
        return viewerFailure("LIVE_COMMENT_ENTRY_VIEWER_THRESHOLD_EXHAUSTED", "VIEWER_THRESHOLD_NOT_MET",
          "连续直播间人数均未达到下限，脚本已停止", "CHECKING_VIEWER_COUNT", {
            viewerCount: viewerCount,
            minViewerCount: minViewerCount,
            viewerCountSource: read.source,
            textSample: read.textSample
          });
      }
      stage("SKIPPING_LOW_VIEWER_ROOM", {
        candidateIndex: candidateIndex,
        viewerCount: viewerCount,
        minViewerCount: minViewerCount
      });
      var nextResult = call("nextLive", "SKIPPING_LOW_VIEWER_ROOM", [], control);
      if (nextResult.stopped) return { status: "STOPPED" };
      if (nextResult.failed) {
        return viewerFailure("LIVE_COMMENT_ENTRY_VIEWER_THRESHOLD_FAILED", "NEXT_LIVE_ROOM_FAILED",
          "人数不足后切换下一个直播间失败，脚本已停止", "SKIPPING_LOW_VIEWER_ROOM", {
            viewerCount: viewerCount,
            minViewerCount: minViewerCount
          });
      }
      if (runtime.waitRandom) runtime.waitRandom(1000, 2000);
      var verification = detectPlatformVerification("CHECKING_VIEWER_COUNT", control);
      if (verification) return platformVerificationFailure("CHECKING_VIEWER_COUNT", verification);
    }
    return null;
  }

  var captureRunner = captureRunnerModule.createCommentCaptureRunner({
    context: context,
    runtime: runtime,
    commentCapture: options.commentCapture,
    stage: stage,
    call: call,
    stopped: stopped,
    detectPlatformVerification: detectPlatformVerification,
    platformVerificationFailure: platformVerificationFailure
  });

  function captureScope(payload, candidateIndex) {
    var configuredDevice = context.config && context.config.device || {};
    var keyword = String(payload.targetKeyword || payload.keyword || "").trim().toLowerCase();
    return {
      batchId: String(payload.batchId || ""),
      deviceId: String(payload.deviceId || options.deviceId || configuredDevice.deviceId || ""),
      roomKey: String(payload.roomKey || "live-comment:" + keyword + ":candidate:" + (candidateIndex || 1))
    };
  }

  function cleanupCompletedForLiveEntry(cleanup) {
    if (!cleanup || cleanup.completed !== true || cleanup.fallback === "HOME") return false;
    var reason = String(cleanup.cleanupReason || cleanup.reason || "");
    return reason !== "RECENTS_UNAVAILABLE" &&
      reason !== "DOUYIN_RECENTS_CARD_NOT_FOUND" &&
      reason !== "DOUYIN_RECENTS_DISMISS_FAILED";
  }

  function finishAfterEntry(payload, viewerResult, control) {
    var result = captureRunner.capture(captureScope(payload, viewerResult && viewerResult.candidateIndex), control) || {
      status: "LIVE_COMMENT_ENTRY_ENTERED"
    };
    if (result.status === "STOPPED") return result;
    if (viewerResult) {
      result.viewerCount = viewerResult.viewerCount;
      result.minViewerCount = viewerResult.minViewerCount;
    }

    if (finalCleanup && typeof finalCleanup.run === "function") {
      stage("CLEANING_UP", { commentCount: Number(result.commentCount || 0) });
      var cleanup;
      try {
        cleanup = finalCleanup.run({ taskId: String(payload.batchId || "") }, {
          beforeReturnToAgent: function () {
            stage("RETURNING_TO_AGENT", { commentCount: Number(result.commentCount || 0) });
          }
        });
      } catch (error) {
        cleanup = { completed: false, reason: "LIVE_COMMENT_ENTRY_CLEANUP_FAILED", message: String(error) };
      }
      result.cleanup = cleanup || { completed: false, reason: "LIVE_COMMENT_ENTRY_CLEANUP_EMPTY_RESULT" };
      result.cleanupAttempted = true;
      if (cleanupCompletedForLiveEntry(result.cleanup)) {
        stage("CLEANUP_COMPLETED", { commentCount: Number(result.commentCount || 0) });
      } else {
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
    if (result.status !== "LIVE_COMMENT_ENTRY_ENTERED") {
      stage("FAILED", {
        failedStage: result.failedStage || "CLEANING_UP",
        reasonCode: result.reasonCode,
        message: result.message,
        commentCount: Number(result.commentCount || 0)
      });
    }
    return result;
  }

  function isNoResult(value) {
    return value === false || !!(value && (
      value.reason === "NO_RESULT" || value.noResult === true || value.stage === "result_wait"
    ));
  }

  function run(payload, control) {
    payload = payload || {};
    control = control || {};
    if (stopped(control)) return { status: "STOPPED" };
    var keyword = String(payload.targetKeyword || payload.keyword || "").trim();
    var attempt = 1;

    stage("OPENING_DOUYIN", { attempt: attempt });
    var result = call("openDouyin", "OPENING_DOUYIN", [], control);
    if (result.stopped) return { status: "STOPPED" };
    var verification = detectPlatformVerification("OPENING_DOUYIN", control);
    if (verification) return platformVerificationFailure("OPENING_DOUYIN", verification);
    if (result.failed) return failure("OPENING_DOUYIN", result.message);
    if (runtime.waitRandom) runtime.waitRandom(7000, 7000);
    if (stopped(control)) return { status: "STOPPED" };

    while (attempt <= 2) {
      stage("OPENING_SEARCH", { attempt: attempt });
      stage("INPUT_KEYWORD", { attempt: attempt, keyword: keyword });
      result = call(attempt === 1 ? "openSearch" : "restartSearch", "OPENING_SEARCH", [keyword, control], control);
      if (result.stopped) return { status: "STOPPED" };
      verification = detectPlatformVerification("OPENING_SEARCH", control);
      if (verification) return platformVerificationFailure("OPENING_SEARCH", verification);
      if (result.failed) {
        if (attempt === 1 && result.value && result.value.stage === "result_wait") {
          stage("RETRYING_SEARCH", { attempt: 2, message: result.message });
          attempt = 2;
          continue;
        }
        return failure("OPENING_SEARCH", result.message);
      }
      if (runtime.waitRandom) runtime.waitRandom(300, 900);
      if (stopped(control)) return { status: "STOPPED" };

      stage("OPENING_LIVE_TAB", { attempt: attempt });
      result = call("openLiveTab", "OPENING_LIVE_TAB", [], control);
      if (result.stopped) return { status: "STOPPED" };
      verification = detectPlatformVerification("OPENING_LIVE_TAB", control);
      if (verification) return platformVerificationFailure("OPENING_LIVE_TAB", verification);
      if (result.failed) return failure("OPENING_LIVE_TAB", result.message);
      if (runtime.waitRandom) runtime.waitRandom(1000, 3000);

      stage("OPENING_FIRST_RESULT", { attempt: attempt });
      result = call("openFirstLive", "OPENING_FIRST_RESULT", [], control);
      if (result.stopped) return { status: "STOPPED" };
      verification = detectPlatformVerification("OPENING_FIRST_RESULT", control);
      if (verification) return platformVerificationFailure("OPENING_FIRST_RESULT", verification);
      if (result.failed) {
        if (attempt >= 2 || !isNoResult(result.value)) return failure("OPENING_FIRST_RESULT", result.message);
        stage("RETRYING_SEARCH", { attempt: 2, message: result.message });
        attempt = 2;
        continue;
      }

      if (runtime.waitRandom) runtime.waitRandom(1000, 3000);
      var viewerResult = viewerThreshold(payload, control);
      if (viewerResult && viewerResult.status) return viewerResult;
      if (stopped(control)) return { status: "STOPPED" };
      var liveRoomReady = false;
      for (var confirmAttempt = 1; confirmAttempt <= 3; confirmAttempt += 1) {
        result = call("isLiveRoom", "OPENING_FIRST_RESULT", [], control);
        if (result.stopped) return { status: "STOPPED" };
        verification = detectPlatformVerification("OPENING_FIRST_RESULT", control);
        if (verification) return platformVerificationFailure("OPENING_FIRST_RESULT", verification);
        if (!result.failed && result.value) { liveRoomReady = true; break; }
        if (confirmAttempt < 3 && runtime.waitRandom) runtime.waitRandom(600, 900);
      }
      if (!liveRoomReady) return failure("OPENING_FIRST_RESULT", result.message || "LIVE_ROOM_NOT_READY");

      stage("ENTERED", { attempt: attempt, viewerCount: viewerResult && viewerResult.viewerCount });
      return finishAfterEntry(payload, viewerResult, control);
    }
    return failure("OPENING_FIRST_RESULT", "LIVE_ENTRY_NOT_FOUND");
  }

  return { run: run };
}

module.exports = {
  createLiveCommentEntryTask: createLiveCommentEntryTask
};
