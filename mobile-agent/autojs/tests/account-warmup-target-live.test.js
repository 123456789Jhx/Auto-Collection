var assert = require("assert");
var targetLiveEntry = require("../features/account-warmup/target-live-entry.js");
var createTargetLiveEntryTask = targetLiveEntry.createTargetLiveEntryTask;

function payload(overrides) {
  var value = {
    batchId: "batch-1",
    targetKeyword: "药材种植",
    relatedTerms: ["当归", "三七"],
    maxRounds: 3,
    candidatesPerRound: 4
  };
  overrides = overrides || {};
  Object.keys(overrides).forEach(function (key) { value[key] = overrides[key]; });
  return value;
}

function createRuntime(evidenceByAttempt) {
  var events = [];
  var evidenceIndex = 0;
  return {
    events: events,
    openDouyin: function () { events.push("open_douyin"); return true; },
    openSearch: function (keyword) { events.push("search:" + keyword); return true; },
    openLiveTab: function () { events.push("live_tab"); return true; },
    advanceCandidate: function (index) { events.push("advance:" + index); return true; },
    openFirstLive: function () { events.push("open_live"); return true; },
    isLiveRoom: function () { return true; },
    readStableEvidence: function () { return evidenceByAttempt[evidenceIndex++] || { accessibilityText: "", ocrText: "" }; },
    nextLive: function () { events.push("next_live"); return true; },
    recover: function () { events.push("recover"); return true; },
    waitRandom: function (min, max) { events.push("wait:" + min + "-" + max); }
  };
}

function testRelatedTermMatchesOnlyFromOcrEvidence() {
  var relatedRuntime = createRuntime([{ accessibilityText: "", ocrText: "老张直播间\n今天介绍何首乌" }]);
  var related = createTargetLiveEntryTask({ runtime: relatedRuntime }).run(payload({ relatedTerms: ["何首乌"] }), { shouldStop: function () { return false; } });
  assert.strictEqual(related.status, "TARGET_LIVE_ENTERED");
  assert.strictEqual(related.matchedTerm, "何首乌");
  assert.strictEqual(related.matchMethod, "ocr");

  var accessibilityOnly = createTargetLiveEntryTask({ runtime: createRuntime([]) }).matchEvidence(
    { accessibilityText: "当归", ocrText: "" },
    ["当归"]
  );
  assert.strictEqual(accessibilityOnly.matched, false);
}

function testTargetKeywordAloneDoesNotReplaceRelatedTerms() {
  var evidence = [];
  for (var i = 0; i < 12; i++) evidence.push({ ocrText: "药材种植", commerceCartVisible: false });
  var result = createTargetLiveEntryTask({ runtime: createRuntime(evidence) }).run(payload(), { shouldStop: function () { return false; } });
  assert.strictEqual(result.status, "TARGET_LIVE_NOT_FOUND");
}

function testRetriesThreeRoundsOfFourCandidates() {
  var runtime = createRuntime([]);
  var result = createTargetLiveEntryTask({ runtime: runtime }).run(payload(), { shouldStop: function () { return false; } });
  assert.strictEqual(result.status, "TARGET_LIVE_NOT_FOUND");
  assert.strictEqual(result.attempts, 12);
  assert.strictEqual(runtime.events.filter(function (item) { return item === "open_live"; }).length, 3);
  assert.strictEqual(runtime.events.filter(function (item) { return item === "next_live"; }).length, 9);
  assert.strictEqual(runtime.events.filter(function (item) { return item === "recover"; }).length, 3);
}

function testStopsAtActionBoundary() {
  var runtime = createRuntime([]);
  var result = createTargetLiveEntryTask({ runtime: runtime }).run(payload(), { shouldStop: function () { return true; } });
  assert.strictEqual(result.status, "STOPPED");
  assert.strictEqual(runtime.events.length, 0);
}

function testStopsWhileFastSearchIsWaiting() {
  var runtime = createRuntime([]);
  runtime.openSearch = function () { return { success: false, stopped: true, stage: "input_wait" }; };
  var result = createTargetLiveEntryTask({ runtime: runtime }).run(payload(), { shouldStop: function () { return false; } });
  assert.strictEqual(result.status, "STOPPED");
  assert.strictEqual(result.attempts, 0);
}

function testWaitsFixedSevenSecondsBeforeOpeningSearch() {
  var runtime = createRuntime([{ accessibilityText: "", ocrText: "当归" }]);
  var result = createTargetLiveEntryTask({ runtime: runtime }).run(payload(), { shouldStop: function () { return false; } });
  assert.strictEqual(result.status, "TARGET_LIVE_ENTERED");
  assert.deepStrictEqual(runtime.events.slice(0, 3), [
    "open_douyin",
    "wait:7000-7000",
    "search:药材种植"
  ]);
}

function testClicksFirstLiveAfterFixedThreeSecondTabWait() {
  var runtime = createRuntime([{ accessibilityText: "", ocrText: "当归" }]);
  var result = createTargetLiveEntryTask({ runtime: runtime }).run(payload(), { shouldStop: function () { return false; } });
  assert.strictEqual(result.status, "TARGET_LIVE_ENTERED");
  assert.deepStrictEqual(runtime.events.slice(0, 6), [
    "open_douyin",
    "wait:7000-7000",
    "search:药材种植",
    "live_tab",
    "wait:3000-3000",
    "open_live"
  ]);
}

function testFirstLiveCardUsesStableFirstResultPoint() {
  var points = [];
  var clicked = targetLiveEntry.clickFirstLiveCard({
    screenSize: function () { return { width: 1080, height: 2248 }; },
    clickPoint: function (x, y) { points.push([x, y]); return true; }
  });
  assert.strictEqual(clicked, true);
  assert.deepStrictEqual(points, [[388, 786]]);
}

function testCommerceCartOverridesRelatedTermAndMovesToNextLive() {
  var runtime = createRuntime([
    { ocrText: "当归种植直播间", commerceCartVisible: true },
    { ocrText: "三七种植直播间", commerceCartVisible: false }
  ]);
  var result = createTargetLiveEntryTask({ runtime: runtime }).run(payload(), { shouldStop: function () { return false; } });
  assert.strictEqual(result.status, "TARGET_LIVE_ENTERED");
  assert.strictEqual(result.matchedTerm, "三七");
  assert.strictEqual(runtime.events.filter(function (item) { return item === "next_live"; }).length, 1);
  assert.strictEqual(runtime.events.filter(function (item) { return item === "recover"; }).length, 0);
}

function testSessionReceivesValidatorForEveryLaterLive() {
  var runtime = createRuntime([
    { ocrText: "当归种植直播间", commerceCartVisible: false },
    { ocrText: "无关娱乐直播", commerceCartVisible: false },
    { ocrText: "三七种植直播间", commerceCartVisible: false }
  ]);
  var validationResults = [];
  var task = createTargetLiveEntryTask({
    runtime: runtime,
    sessionRunner: {
      run: function (_, __, sessionControl) {
        assert(sessionControl && typeof sessionControl.validateCurrentLive === "function");
        validationResults.push(sessionControl.validateCurrentLive());
        validationResults.push(sessionControl.validateCurrentLive());
        return { status: "STOPPED" };
      }
    }
  });

  var result = task.run(payload(), { shouldStop: function () { return false; } });
  assert.strictEqual(result.status, "STOPPED");
  assert.deepStrictEqual(validationResults, [
    { matched: false, reason: "RELATED_TERM_NOT_MATCHED" },
    { matched: true, matchedTerm: "三七", matchMethod: "ocr" }
  ]);
}

function testDetectsOrangeCartClusterInBottomCommentArea() {
  var image = {};
  var detected = targetLiveEntry.detectCommerceCart(image, {
    screenSize: function () { return { width: 1080, height: 2248 }; },
    getPixelRgb: function (_, x, y) {
      if (x >= 580 && x <= 630 && y >= 1980 && y <= 2040) return { r: 244, g: 126, b: 20 };
      return { r: 30, g: 30, b: 30 };
    }
  });
  assert.strictEqual(detected, true);
  assert.strictEqual(targetLiveEntry.detectCommerceCart(image, {
    screenSize: function () { return { width: 1080, height: 2248 }; },
    getPixelRgb: function () { return { r: 240, g: 40, b: 130 }; }
  }), false);
}

function testNextLiveTreatsVoidAdapterMethodAsSuccess() {
  var calls = 0;
  assert.strictEqual(targetLiveEntry.invokeNextLive({
    nextVideo: function () { calls += 1; }
  }), true);
  assert.strictEqual(calls, 1);
}

testRelatedTermMatchesOnlyFromOcrEvidence();
testTargetKeywordAloneDoesNotReplaceRelatedTerms();
testRetriesThreeRoundsOfFourCandidates();
testStopsAtActionBoundary();
testStopsWhileFastSearchIsWaiting();
testWaitsFixedSevenSecondsBeforeOpeningSearch();
testClicksFirstLiveAfterFixedThreeSecondTabWait();
testFirstLiveCardUsesStableFirstResultPoint();
testCommerceCartOverridesRelatedTermAndMovesToNextLive();
testSessionReceivesValidatorForEveryLaterLive();
testDetectsOrangeCartClusterInBottomCommentArea();
testNextLiveTreatsVoidAdapterMethodAsSuccess();
console.log("account warmup target live tests passed");
