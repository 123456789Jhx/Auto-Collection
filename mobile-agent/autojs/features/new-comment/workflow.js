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

  function waitForStop(control) {
    while (!stopped(control)) {
      // Waiting is not a business operation. Timer errors must not turn an entered room into a failed task.
      wait(control, 500, 800);
    }
    return { status: "STOPPED" };
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
    result = wait(control, 1000, 3000);
    if (result.stopped) return { status: "STOPPED" };
    stage("ENTERED", { attempt: 1 });
    return waitForStop(control);
  }

  return { run: run };
}

module.exports = { createIsolatedLiveCommentWorkflow: createIsolatedLiveCommentWorkflow };
