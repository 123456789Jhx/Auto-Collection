"use strict";

var defaultCommentRunner = require("./comment-runner.js");

function createIsolatedLiveCommentWorkflow(options) {
  options = options || {};
  var runtime = options.runtime || {};
  var captureRoomSequence = 0;
  var reportStage = options.reportStage || function () {};
  var logger = options.logger || {};

  function log(level, message, details) {
    try {
      if (typeof logger[level] === "function") logger[level](message, details || {});
    } catch (error) {}
  }

  function stopped(control) {
    try { return !!(control && typeof control.shouldStop === "function" && control.shouldStop()); }
    catch (error) { return true; }
  }

  function stage(name, payload) {
    var event = payload || {};
    event.stage = name;
    reportStage(event);
  }

  function failure(failedStage, message) {
    stage("FAILED", { failedStage: failedStage, message: message });
    return { status: "LIVE_COMMENT_ENTRY_FAILED", failedStage: failedStage, message: message };
  }

  function call(name, failedStage, args, control) {
    if (stopped(control)) return { stopped: true };
    if (typeof runtime[name] !== "function") return { failed: true, message: name + " unavailable" };
    var raw;
    try { raw = runtime[name].apply(runtime, args || []); }
    catch (error) {
      return stopped(control) ? { stopped: true } : { failed: true, message: String(error && error.message || error) };
    }
    if (stopped(control) || raw && (raw.stopped || raw.reason === "STOP_REQUESTED")) {
      return { stopped: true, value: raw && (raw.details || raw.value) };
    }
    if (raw && raw.success === true) return { value: raw.value };
    if (raw === false || raw && raw.success === false) {
      return { failed: true, value: raw,
        message: String(raw && (raw.message || raw.stage || raw.reason) || failedStage) };
    }
    return { value: raw };
  }

  function wait(control, min, max, purpose) {
    var details = { minMs: min, maxMs: max, purpose: purpose || "未指定" };
    log("info", "抓取评论词新流程等待开始", details);
    var result = call("waitRandom", "WAITING", [min, max], control);
    log(result.failed ? "warn" : result.stopped ? "warn" : "info",
      "抓取评论词新流程等待完成", {
        minMs: min, maxMs: max, purpose: purpose || "未指定",
        success: !result.failed && !result.stopped, stopped: !!result.stopped,
        message: result.message || ""
      });
    return result;
  }

  function fallbackSleep(min, max) {
    var milliseconds = Math.floor(min + Math.random() * (max - min + 1));
    try {
      if (typeof runtime.sleep === "function") {
        runtime.sleep(milliseconds);
        return;
      }
    } catch (error) {}
    try {
      if (typeof sleep === "function") sleep(milliseconds);
    } catch (error2) {}
  }

  function waitForStop(control) {
    while (!stopped(control)) {
      // Waiting is not a business operation. Timer errors must not turn an entered room into a failed task.
      var result = wait(control, 500, 800);
      if (result.failed) fallbackSleep(500, 800);
    }
    return { status: "STOPPED" };
  }

  function viewerCount(value) {
    value = value && value.value !== undefined ? value.value : value;
    if (!value || value.count === undefined || value.count === null) return null;
    var count = Number(value.count);
    return isFinite(count) ? Math.floor(count) : null;
  }

  function identifyAndClaimRoom(config, control) {
    var result = wait(control, 5000, 7000, "点击主播信息前等待");
    if (result.stopped) return { stopped: true };
    result = call("openAnchorSummary", "OPENING_ANCHOR_SUMMARY", [], control);
    if (result.stopped) return { stopped: true };
    if (result.failed) return { failed: true, reasonCode: "ANCHOR_SUMMARY_OPEN_FAILED", message: result.message };

    result = wait(control, 5000, 7000, "点击主播主页前等待");
    if (result.stopped) return { stopped: true };
    result = call("openAnchorProfile", "OPENING_ANCHOR_PROFILE", [], control);
    if (result.stopped) return { stopped: true };
    if (result.failed) return { failed: true, reasonCode: "ANCHOR_PROFILE_OPEN_FAILED", message: result.message };

    result = wait(control, 5000, 7000, "主播主页身份 OCR 前等待");
    if (result.stopped) return { stopped: true };
    var identityRead = call("readRoomIdentity", "READING_ROOM_IDENTITY", [], control);
    var profile = identityRead.failed ? identityRead.value && identityRead.value.details : identityRead.value;
    if (identityRead.stopped) return { stopped: true, identity: profile };
    log(identityRead.failed ? "warn" : "info", "抓取评论词主播主页采集完成", {
      screenshotSaved: !!(profile && profile.screenshotSaved),
      ocrExecuted: !!(profile && profile.ocrExecuted), ocrSucceeded: !!(profile && profile.ocrSucceeded),
      screenshotPath: profile && profile.screenshotPath || "", message: identityRead.message || ""
    });

    result = wait(control, 5000, 7000, "返回直播间前等待");
    if (result.stopped) {
      return { stopped: true, identity: profile };
    }
    var closed = call("closeAnchorProfile", "CLOSING_ANCHOR_PROFILE", [], control);
    if (closed.stopped) {
      return { stopped: true, identity: profile };
    }
    if (closed.failed) {
      return { failed: true, reasonCode: "ANCHOR_PROFILE_CLOSE_FAILED", message: closed.message,
        failedStage: "CLOSING_ANCHOR_PROFILE", identity: profile };
    }
    if (identityRead.failed) {
      return { failed: true, reasonCode: identityRead.value && identityRead.value.reason || "OCR_FAILED",
        failedStage: profile && profile.failedStage || "READING_ROOM_IDENTITY",
        message: identityRead.message, identity: profile };
    }
    if (!profile || !String(profile.text || "").trim()) {
      return { failed: true, reasonCode: "OCR_EMPTY", failedStage: "READING_ROOM_IDENTITY",
        message: "指定区域未识别到文字", identity: profile };
    }
    return {
      acquired: true,
      roomKey: "",
      accountName: "",
      accountId: "",
      identity: profile
    };
  }

  function screenRooms(config, control) {
    var minimum = Number(config.minViewerCount);
    minimum = isFinite(minimum) ? Math.max(0, Math.floor(minimum)) : 300;
    var configuredLimit = Number(config.maxRoomAttempts || config.maxRooms || 10);
    var maxAttempts = isFinite(configuredLimit) ? Math.max(1, Math.min(50, Math.floor(configuredLimit))) : 10;
    var attempted = 0;
    while (attempted < maxAttempts) {
      if (stopped(control)) return { stopped: true };
      attempted += 1;
      stage("SCREENING_VIEWER_COUNT", { attempt: attempted, maxAttempts: maxAttempts });
      log("info", "抓取评论词开始读取直播间人数", { attempt: attempted, maxAttempts: maxAttempts, minViewerCount: minimum });
      var read = call("readViewerCount", "SCREENING_VIEWER_COUNT", [], control);
      if (read.stopped) return { stopped: true };
      var count = read.failed ? null : viewerCount(read.value);
      var ended = !read.failed && !!(read.value && read.value.ended);
      var commerceCartVisible = false;
      var reasonCode = read.failed ? "VIEWER_COUNT_UNAVAILABLE" :
        ended ? "LIVE_ENDED" : commerceCartVisible ? "COMMERCE_CART_DETECTED" : "VIEWER_COUNT_BELOW_THRESHOLD";
      log(read.failed ? "warn" : "info", "抓取评论词直播间人数读取完成", {
        attempt: attempted, count: count, raw: read.value, failed: !!read.failed, ended: ended,
        message: read.message || ""
      });
      if (count !== null && count >= minimum) {
        var cart = typeof runtime.readCommerceCart === "function"
          ? call("readCommerceCart", "SCREENING_COMMERCE_CART", [], control)
          : { value: { detected: false } };
        if (cart.stopped) return { stopped: true };
        if (cart.failed || !cart.value || cart.value.detected === true) {
          reasonCode = cart.failed ? "COMMERCE_CART_SCAN_FAILED" : "COMMERCE_CART_DETECTED";
          commerceCartVisible = true;
        }
      }
      if (count !== null && count >= minimum && !commerceCartVisible) {
        stage("READING_ROOM_IDENTITY", { attempt: attempted, viewerCount: count });
        captureRoomSequence += 1;
        var roomClaim = identifyAndClaimRoom(config, control);
        roomClaim.roomKey = "capture:" + captureRoomSequence;
        if (roomClaim.stopped) return roomClaim;
        if (roomClaim.failed) {
          roomClaim.attemptedRoomCount = attempted;
          return roomClaim;
        }
        if (roomClaim.acquired) {
          stage("ROOM_FILTER_PASSED", { attempt: attempted, viewerCount: count,
            minViewerCount: minimum, roomKey: roomClaim.roomKey });
          log("info", "抓取评论词直播间满足条件，进入评论抓取", {
            attempt: attempted, count: count, minViewerCount: minimum, roomKey: roomClaim.roomKey
          });
          return { passed: true, attemptedRoomCount: attempted, viewerCount: count,
            roomKey: roomClaim.roomKey, accountName: roomClaim.accountName,
            accountId: roomClaim.accountId, identity: roomClaim.identity, leaseAcquired: true };
        }
        reasonCode = roomClaim.reasonCode || "ROOM_IDENTITY_UNAVAILABLE";
      }
      if (attempted >= maxAttempts) break;
      stage("SWITCHING_LIVE_ROOM", {
        attempt: attempted,
        viewerCount: count,
        reasonCode: reasonCode
      });
      log("warn", "抓取评论词直播间人数不满足阈值，准备切换直播间", {
        attempt: attempted, count: count, minViewerCount: minimum,
        ended: ended, reasonCode: reasonCode
      });
      var next = call("nextLive", "SWITCHING_LIVE_ROOM", [], control);
      if (next.stopped) return { stopped: true };
      if (next.failed) continue;
      var settle = wait(control, 7500, 8500, "切换直播间后等待人数/小黄车 OCR");
      if (settle.stopped) return { stopped: true };
    }
    log("error", "抓取评论词直播间人数筛选达到上限", {
      attemptedRoomCount: attempted, maxAttempts: maxAttempts, minViewerCount: minimum,
      reasonCode: "NO_ROOM_MATCHED"
    });
    return { failed: true, reasonCode: "NO_ROOM_MATCHED", attemptedRoomCount: attempted, maxAttempts: maxAttempts };
  }

  function run(payload, control) {
    payload = payload || {};
    control = control || {};
    if (stopped(control)) return { status: "STOPPED" };
    var keyword = String(payload.targetKeyword || payload.keyword || "").trim();
    var result;
    var roomProfiles = [];
    function rememberProfile(room) {
      if (!room || !room.identity) return;
      var profile = {};
      Object.keys(room.identity).forEach(function (key) { profile[key] = room.identity[key]; });
      profile.roomKey = String(room.roomKey || "");
      profile.batchId = String(payload.batchId || "");
      profile.deviceId = String(options.deviceId || "");
      roomProfiles.push(profile);
    }

    stage("OPENING_DOUYIN", { attempt: 1 });
    result = call("openDouyin", "OPENING_DOUYIN", [], control);
    if (result.stopped) return { status: "STOPPED" };
    if (result.failed) return failure("OPENING_DOUYIN", result.message);
    result = wait(control, 7000, 7000, "打开抖音后等待");
    if (result.stopped) return { status: "STOPPED" };

    stage("OPENING_SEARCH", { attempt: 1 });
    stage("INPUT_KEYWORD", { attempt: 1, keyword: keyword });
    result = call("openSearch", "OPENING_SEARCH", [keyword, control], control);
    if (result.stopped) return { status: "STOPPED" };
    if (result.failed) return failure("OPENING_SEARCH", result.message);
    result = wait(control, 300, 900, "搜索结果加载");
    if (result.stopped) return { status: "STOPPED" };

    stage("OPENING_LIVE_TAB", { attempt: 1 });
    result = call("openLiveTab", "OPENING_LIVE_TAB", [], control);
    if (result.stopped) return { status: "STOPPED" };
    if (result.failed) return failure("OPENING_LIVE_TAB", result.message);
    result = wait(control, 1000, 3000, "直播标签页加载");
    if (result.stopped) return { status: "STOPPED" };

    stage("OPENING_FIRST_RESULT", { attempt: 1 });
    log("info", "抓取评论词准备点击第一个直播间", { keyword: keyword });
    result = call("openFirstLive", "OPENING_FIRST_RESULT", [], control);
    if (result.stopped) return { status: "STOPPED" };
    log(result.failed ? "warn" : "info", "抓取评论词第一个直播间点击调用完成", {
      failed: !!result.failed, value: result.value, message: result.message || ""
    });
    log("info", "抓取评论词直播间响应等待已由点击动作完成", {});
    var screening = screenRooms(payload, control);
    rememberProfile(screening);
    if (screening.stopped) return { status: "STOPPED", roomProfiles: roomProfiles };
    if (screening.failed) {
      screening.roomProfiles = roomProfiles.slice();
      stage("FAILED", screening);
      return {
        status: "LIVE_COMMENT_ENTRY_FAILED",
        failedStage: screening.failedStage || "SCREENING_VIEWER_COUNT",
        reasonCode: screening.reasonCode,
        message: screening.message || "连续筛选 " + screening.attemptedRoomCount + " 个直播间仍未达到人数阈值",
        attemptedRoomCount: screening.attemptedRoomCount,
        roomProfiles: roomProfiles
      };
    }
    stage("ENTERED", { attempt: 1, viewerCount: screening.viewerCount });
    var commentRunner = options.commentRunner;
    if (!commentRunner && typeof runtime.readComments === "function") {
      commentRunner = defaultCommentRunner.createCommentCaptureRunner({
        runtime: runtime,
        logger: logger,
        reportStage: reportStage,
        captureDurationMinutes: payload.captureDurationMinutes === undefined ? 5 : payload.captureDurationMinutes,
        now: options.now,
        shouldStop: function (activeControl) { return stopped(activeControl); }
      });
    }
    if (!commentRunner || typeof commentRunner.capture !== "function") return waitForStop(control);
    var collectedComments = [];
    var totalSwipeCount = 0;
    var currentScreening = screening;
    while (true) {
      var capture = commentRunner.capture({
        batchId: String(payload.batchId || ""),
        deviceId: String(options.deviceId || ""),
        roomKey: String(currentScreening.roomKey || payload.roomKey || ""),
        accountName: String(currentScreening.accountName || ""),
        accountId: String(currentScreening.accountId || "")
      }, control);
      if (capture && Array.isArray(capture.comments)) {
        collectedComments = collectedComments.concat(capture.comments);
        totalSwipeCount += Number(capture.commentSwipeCount || 0);
      }
      if (capture) capture.roomProfiles = roomProfiles.slice();
      if (capture && capture.status === "STOPPED") {
        capture.comments = collectedComments;
        capture.commentCount = collectedComments.length;
        capture.commentSwipeCount = totalSwipeCount;
        return capture;
      }
      if (!capture || !capture.comments) return capture || waitForStop(control);
      if (capture.captureCompleted !== true) {
        capture.comments = collectedComments;
        capture.commentCount = collectedComments.length;
        return capture;
      }
      capture.screeningAttemptedRoomCount = currentScreening.attemptedRoomCount;
      if (options.continueAfterCapture !== true) return capture;
      if (stopped(control)) return {
        status: "STOPPED", captureStatus: "LIVE_COMMENT_ENTRY_PARTIAL",
        captureCompleted: false, comments: collectedComments,
        commentCount: collectedComments.length, commentSwipeCount: totalSwipeCount, roomProfiles: roomProfiles
      };
      stage("RETURNING_TO_LIVE_ROOM", { roomKey: currentScreening.roomKey });
      var returnWait = wait(control, 800, 1200, "抓取完成后等待切房");
      if (returnWait.stopped) return { status: "STOPPED", comments: collectedComments, commentCount: collectedComments.length, roomProfiles: roomProfiles };
      var nextRoom = call("nextLive", "SWITCHING_LIVE_ROOM", [], control);
      if (nextRoom.stopped) return { status: "STOPPED", comments: collectedComments, commentCount: collectedComments.length, roomProfiles: roomProfiles };
      if (nextRoom.failed) {
        var nextFailure = failure("SWITCHING_LIVE_ROOM", nextRoom.message);
        nextFailure.roomProfiles = roomProfiles;
        return nextFailure;
      }
      var roomWait = wait(control, 7500, 8500, "切换直播间后等待人数/小黄车 OCR");
      if (roomWait.stopped) return { status: "STOPPED", comments: collectedComments, commentCount: collectedComments.length, roomProfiles: roomProfiles };
      currentScreening = screenRooms(payload, control);
      rememberProfile(currentScreening);
      if (currentScreening.stopped) return { status: "STOPPED", comments: collectedComments, commentCount: collectedComments.length, roomProfiles: roomProfiles };
      if (currentScreening.failed) return {
        status: "LIVE_COMMENT_ENTRY_FAILED", failedStage: currentScreening.failedStage || "SCREENING_VIEWER_COUNT",
        reasonCode: currentScreening.reasonCode, comments: collectedComments,
        commentCount: collectedComments.length, roomProfiles: roomProfiles,
        message: currentScreening.message || "连续筛选 " + currentScreening.attemptedRoomCount + " 个直播间仍未达到人数阈值"
      };
    }
  }

  return { run: run };
}

module.exports = { createIsolatedLiveCommentWorkflow: createIsolatedLiveCommentWorkflow };
