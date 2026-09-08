"use strict";
var assert = require("node:assert/strict");
var test = require("node:test");
var layout = require("../features/new-comment/douyin-layout.js");
var readProfile = require("../features/new-comment/anchor-profile.js").readAnchorProfile;
var createRuntime = require("../features/new-comment/runtime.js").createIsolatedRuntime;
var createWorkflow = require("../features/new-comment/workflow.js").createIsolatedLiveCommentWorkflow;

function fixture(settings) {
  settings = settings || {};
  var events = [], images = [], saved = [], recognized = [], logs = [];
  var size = settings.size || { width: 1080, height: 2248 };
  var stopped = false;
  function image(rect) {
    var item = { rect: rect, recycled: 0, recycle: function () { item.recycled += 1; } };
    images.push(item);
    return item;
  }
  var options = {
    screenSize: size, screenshotDir: "/sdcard/profiles", profileScreenshotDir: "/sdcard/profiles",
    shouldStop: function () { return stopped; },
    control: { shouldStop: function () { return stopped; } },
    logger: { info: record, warn: record, error: record },
    captureScreen: function () {
      events.push("capture");
      if (settings.captureError) throw new Error("capture failed");
      if (settings.emptyCapture) return null;
      var frame = image({ left: 0, top: 0, width: size.width, height: size.height });
      return settings.wrapped ? { image: frame } : frame;
    },
    files: { ensureDir: function () {}, join: function (dir, name) { return dir + "/" + name; } },
    images: {
      save: function (source, path) {
        events.push("save");
        if (settings.saveError) throw new Error("save failed");
        if (settings.saveFalse) return false;
        saved.push({ image: source, path: path });
        if (settings.stopAfterSave) stopped = true;
      },
      clip: function (source, left, top, width, height) {
        events.push("clip");
        assert.equal(source, saved[0].image, "OCR must use the same frame that was saved");
        if (settings.clipError) throw new Error("clip failed");
        return image({ left: left, top: top, width: width, height: height });
      }
    },
    ocrEngine: { recognize: function (crop) {
      events.push("ocr"); recognized.push(crop.rect);
      if (settings.ocrError) throw new Error("OCR failed");
      if (settings.stopAfterOcr) stopped = true;
      return settings.text === undefined ? "Business name\nStore authorization" : settings.text;
    } }
  };
  function record(message, details) { logs.push({ message: message, details: Object.assign({}, details) }); }
  if (settings.missingOcr) options.ocrEngine = {};
  if (settings.missingSave) delete options.images.save;
  return { options: options, events: events, images: images, saved: saved, recognized: recognized, logs: logs };
}
function recycled(state) {
  state.images.forEach(function (item) { assert.equal(item.recycled, 1); });
}

[false, true].forEach(function (wrapped) {
  test("saves full " + (wrapped ? "wrapped" : "plain") + " frame before one exact OCR crop", function () {
    var state = fixture({ wrapped: wrapped });
    var result = readProfile(state.options);
    assert.equal(result.success, true);
    assert.deepEqual(state.events, ["capture", "save", "clip", "ocr"]);
    assert.deepEqual(state.saved[0].image.rect, { left: 0, top: 0, width: 1080, height: 2248 });
    assert.deepEqual(state.recognized, [{ left: 360, top: 271, width: 643, height: 269 }]);
    assert.equal(result.value.screenshotPath, state.saved[0].path);
    assert.equal(result.value.screenshotSaved, true);
    assert.equal(result.value.ocrExecuted, true);
    assert.equal(result.value.ocrSucceeded, true);
    assert.equal(result.value.text, "Business name\nStore authorization");
    assert.equal(result.value.accountName || "", "");
    assert.equal(result.value.accountId || "", "");
    assert.equal(result.value.profileInfoText, undefined);
    assert.ok(state.logs.some(function (entry) { return entry.details.screenshotSaved && !entry.details.ocrExecuted; }));
    recycled(state);
  });
});

test("region scaling uses exact endpoint arithmetic", function () {
  var size = { width: 540, height: 1124 };
  assert.deepEqual(layout.getRegion("anchorProfileCapture", size), {
    name: "anchorProfileCapture", left: 0, top: 0, width: 540, height: 1124
  });
  var state = fixture({ size: size });
  assert.equal(readProfile(state.options).success, true);
  assert.deepEqual(state.recognized, [{ left: 180, top: 136, width: 322, height: 134 }]);
});

test("all nonempty OCR text is preserved without identity parsing", function () {
  ["\u6296\u97f3\u53f7:123456", "\u5173\u6ce8", "123456", "x".repeat(250), "  Company\nLicense  "].forEach(function (text) {
    var state = fixture({ text: text });
    var result = readProfile(state.options);
    assert.equal(result.success, true);
    assert.equal(result.value.text, text);
    recycled(state);
  });
});

[
  { settings: { ocrError: true }, reason: "OCR_FAILED", executed: true },
  { settings: { text: " \n " }, reason: "OCR_EMPTY", executed: true },
  { settings: { missingOcr: true }, reason: "OCR_UNAVAILABLE", executed: false },
  { settings: { clipError: true }, reason: "OCR_FAILED", executed: false }
].forEach(function (item) {
  test("retains saved screenshot on " + item.reason + " " + JSON.stringify(item.settings), function () {
    var state = fixture(item.settings), result = readProfile(state.options);
    assert.equal(result.success, false);
    assert.equal(result.reason, item.reason);
    assert.equal(result.details.screenshotSaved, true);
    assert.equal(result.details.screenshotPath, state.saved[0].path);
    assert.equal(result.details.ocrExecuted, item.executed);
    assert.equal(result.details.ocrSucceeded, false);
    assert.equal(result.details.failedStage, "READING_ROOM_IDENTITY");
    recycled(state);
  });
});

[{ captureError: true }, { emptyCapture: true }, { saveError: true }, { saveFalse: true }, { missingSave: true }]
  .forEach(function (settings) {
    test("screenshot failure prevents OCR " + JSON.stringify(settings), function () {
      var state = fixture(settings), result = readProfile(state.options);
      assert.equal(result.success, false);
      assert.equal(result.reason, "SCREEN_CAPTURE_FAILED");
      assert.equal(result.details.screenshotSaved, false);
      assert.equal(result.details.ocrExecuted, false);
      assert.equal(result.details.failedStage, "CAPTURING_ANCHOR_PROFILE");
      assert.equal(state.recognized.length, 0);
      recycled(state);
    });
  });

[{ stopAfterSave: true }, { stopAfterOcr: true }].forEach(function (settings) {
  test("runtime retains saved evidence when stopped " + JSON.stringify(settings), function () {
    var state = fixture(settings), result = createRuntime({}, state.options).readRoomIdentity();
    assert.equal(result.success, false);
    assert.equal(result.reason, "STOP_REQUESTED");
    assert.equal(result.details.screenshotPath, state.saved[0].path);
    if (settings.stopAfterSave) assert.equal(state.recognized.length, 0);
    recycled(state);
  });
});

function workflowFixture(settings) {
  var state = fixture(settings), stages = [], captureCount = 0;
  var runtime = createRuntime({}, state.options);
  ["openDouyin", "openSearch", "openLiveTab", "openFirstLive", "openAnchorSummary", "openAnchorProfile", "waitRandom"]
    .forEach(function (name) { runtime[name] = function () { return true; }; });
  runtime.readViewerCount = function () { return { count: 50 }; };
  runtime.readCommerceCart = function () { return { detected: false }; };
  runtime.closeAnchorProfile = function () { state.events.push("back"); return true; };
  var result = createWorkflow({
    runtime: runtime, deviceId: "device-1", reportStage: function (event) { stages.push(event); },
    commentRunner: { capture: function (scope) {
      captureCount += 1;
      assert.equal(scope.accountName, "");
      assert.equal(scope.roomKey, "capture:1");
      return { status: "LIVE_COMMENT_ENTRY_ENTERED", captureCompleted: true, comments: [] };
    } }
  }).run({ batchId: "batch-1", minViewerCount: 10 }, state.options.control);
  return { state: state, result: result, stages: stages, captureCount: captureCount };
}

test("workflow continues on raw text and associates the full screenshot with the task room", function () {
  var output = workflowFixture({ text: "Business authorization only" });
  assert.equal(output.captureCount, 1);
  assert.ok(output.state.events.indexOf("back") > output.state.events.indexOf("ocr"));
  assert.equal(output.result.roomProfiles[0].text, "Business authorization only");
  assert.equal(output.result.roomProfiles[0].roomKey, "capture:1");
  assert.equal(output.result.roomProfiles[0].batchId, "batch-1");
  assert.equal(output.result.roomProfiles[0].deviceId, "device-1");
});

test("workflow reports the OCR failure with the saved screenshot instead of losing evidence", function () {
  var output = workflowFixture({ ocrError: true });
  assert.equal(output.captureCount, 0);
  assert.equal(output.result.failedStage, "READING_ROOM_IDENTITY");
  assert.equal(output.result.reasonCode, "OCR_FAILED");
  assert.equal(output.result.roomProfiles[0].screenshotPath, output.state.saved[0].path);
  assert.equal(output.result.roomProfiles[0].roomKey, "capture:1");
  assert.ok(output.stages.some(function (stage) { return stage.stage === "FAILED" && stage.roomProfiles.length === 1; }));
});

test("workflow STOP after saving keeps the screenshot and does not return-click or capture comments", function () {
  var output = workflowFixture({ stopAfterSave: true });
  assert.equal(output.result.status, "STOPPED");
  assert.equal(output.captureCount, 0);
  assert.equal(output.state.events.includes("back"), false);
  assert.equal(output.result.roomProfiles[0].screenshotPath, output.state.saved[0].path);
});
