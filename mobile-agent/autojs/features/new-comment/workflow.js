"use strict";

function createIsolatedLiveCommentWorkflow(options) {
  options = options || {};
  var runtime = options.runtime || {};
  var reportStage = options.reportStage || function () {};

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
    if (stopped(control) || raw && (raw.stopped || raw.reason === "STOP_REQUESTED")) return { stopped: true };
    if (raw && raw.success === true) return { value: raw.value };
    if (raw === false || raw && raw.success === false) {
      return { failed: true, value: raw,
        message: String(raw && (raw.message || raw.stage || raw.reason) || failedStage) };
    }
    return { value: raw };
  }

  function wait(control, min, max) {
    return call("waitRandom", "WAITING", [min, max], control);
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
      var read = call("readViewerCount", "SCREENING_VIEWER_COUNT", [], control);
      if (read.stopped) return { stopped: true };
      var count = read.failed ? null : viewerCount(read.value);
      if (count !== null && count >= minimum) {
        stage("ROOM_FILTER_PASSED", { attempt: attempted, viewerCount: count, minViewerCount: minimum });
        return { passed: true, attemptedRoomCount: attempted, viewerCount: count };
      }
      if (attempted >= maxAttempts) break;
      stage("SWITCHING_LIVE_ROOM", {
        attempt: attempted,
        viewerCount: count,
        reasonCode: count === null ? "VIEWER_COUNT_UNAVAILABLE" : "VIEWER_COUNT_BELOW_THRESHOLD"
      });
      var next = call("nextLive", "SWITCHING_LIVE_ROOM", [], control);
      if (next.stopped) return { stopped: true };
      if (next.failed) continue;
      var settle = wait(control, 1000, 2000);
      if (settle.stopped) return { stopped: true };
    }
    return { failed: true, reasonCode: "NO_ROOM_MATCHED", attemptedRoomCount: attempted, maxAttempts: maxAttempts };
  }

  function run(payload, control) {
    payload = payload || {};
    control = control || {};
    if (stopped(control)) return { status: "STOPPED" };
    var keyword = String(payload.targetKeyword || payload.keyword || "").trim();
    var result;

    stage("OPENING_DOUYIN", { attempt: 1 });
    result = call("openDouyin", "OPENING_DOUYIN", [], control);
    if (result.stopped) return { status: "STOPPED" };
    if (result.failed) return failure("OPENING_DOUYIN", result.message);
    result = wait(control, 7000, 7000);
    if (result.stopped) return { status: "STOPPED" };

    stage("OPENING_SEARCH", { attempt: 1 });
    stage("INPUT_KEYWORD", { attempt: 1, keyword: keyword });
    result = call("openSearch", "OPENING_SEARCH", [keyword, control], control);
    if (result.stopped) return { status: "STOPPED" };
    if (result.failed) return failure("OPENING_SEARCH", result.message);
    result = wait(control, 300, 900);
    if (result.stopped) return { status: "STOPPED" };

    stage("OPENING_LIVE_TAB", { attempt: 1 });
    result = call("openLiveTab", "OPENING_LIVE_TAB", [], control);
    if (result.stopped) return { status: "STOPPED" };
    if (result.failed) return failure("OPENING_LIVE_TAB", result.message);
    result = wait(control, 1000, 3000);
    if (result.stopped) return { status: "STOPPED" };

    stage("OPENING_FIRST_RESULT", { attempt: 1 });
    result = call("openFirstLive", "OPENING_FIRST_RESULT", [], control);
    if (result.stopped) return { status: "STOPPED" };
    result = wait(control, 3000, 3000);
    if (result.stopped) return { status: "STOPPED" };
    var screening = screenRooms(payload, control);
    if (screening.stopped) return { status: "STOPPED" };
    if (screening.failed) {
      stage("FAILED", screening);
      return {
        status: "LIVE_COMMENT_ENTRY_FAILED",
        failedStage: "SCREENING_VIEWER_COUNT",
        reasonCode: screening.reasonCode,
        message: "连续筛选 " + screening.attemptedRoomCount + " 个直播间仍未达到人数阈值",
        attemptedRoomCount: screening.attemptedRoomCount
      };
    }
    stage("ENTERED", { attempt: 1 });
    return waitForStop(control);
  }

  return { run: run };
}

module.exports = { createIsolatedLiveCommentWorkflow: createIsolatedLiveCommentWorkflow };
