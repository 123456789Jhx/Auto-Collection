var assert = require("assert");
var fs = require("fs");
var path = require("path");
var createLikeExecutor = require("../features/account-warmup/like-executor.js").createLikeExecutor;
var createCommentFlow = require("../features/account-warmup/comment-flow.js").createCommentFlow;
var createTargetLiveEntryTask = require("../features/account-warmup/target-live-entry.js").createTargetLiveEntryTask;

function testLikeExecutorSkipsTheFinalLikeDelay() {
  var waits = [];
  var completed = createLikeExecutor({
    doubleTap: function () { return true; },
    wait: function (delayMs) { waits.push(delayMs); }
  }).run([
    { id: "like-1", delayAfterMs: 1200 },
    { id: "like-2", delayAfterMs: 5255 }
  ]);
  assert.deepStrictEqual(completed, { status: "COMPLETED", completed: 2 });
  assert.deepStrictEqual(waits, [1200]);
}

function testCommentFlowUsesConfiguredCountAndAllowsRepeatedWords() {
  var waits = [];
  var sent = [];
  var randomValues = [0, 0.999999, 0];
  var flow = createCommentFlow({
    random: function () { return randomValues.shift(); },
    waitRandom: function (min, max) { waits.push([min, max]); return min; },
    sendComment: function (comment, options) {
      sent.push({ comment: comment, options: options });
      return { success: true };
    }
  });
  var result = flow.run({ commentCount: 2, commentLibrary: ["好内容", "学习了"] });
  assert.strictEqual(result.status, "COMPLETED");
  assert.deepStrictEqual(result.sentComments, ["好内容", "好内容"]);
  assert.deepStrictEqual(waits, [[2345, 4876], [3634, 5187]]);
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[0].options.afterInputClickDelayMs, 4876);
  assert.strictEqual(sent[1].options.afterInputClickDelayMs, 0);
  assert.strictEqual(sent[0].options.allowUnconfiguredReply, true);
  assert.strictEqual(sent[0].options.skipDefaultInputDelay, true);
}

function testCommentFlowDoesNothingWhenCommentCountIsZero() {
  var sends = 0;
  var waits = 0;
  var result = createCommentFlow({
    waitRandom: function () { waits += 1; },
    sendComment: function () { sends += 1; return { success: true }; }
  }).run({ commentCount: 0, commentLibrary: ["好内容"] });
  assert.deepStrictEqual(result, { status: "COMPLETED", sentComments: [] });
  assert.strictEqual(waits, 0);
  assert.strictEqual(sends, 0);
}

function testCommentFlowStopsWhenBackendStopArrivesDuringInput() {
  var stopRequested = false;
  var observedStopCallback = false;
  var result = createCommentFlow({
    waitRandom: function () { return 0; },
    sendComment: function (_, options) {
      observedStopCallback = typeof options.shouldStop === "function";
      stopRequested = true;
      return { success: false, failureReason: "stopped_during_comment_input" };
    }
  }).run({ commentCount: 1, commentLibrary: ["好内容"] }, {
    shouldStop: function () { return stopRequested; }
  });

  assert.strictEqual(observedStopCallback, true);
  assert.deepStrictEqual(result, { status: "STOPPED", sentComments: [] });
}

function testDouyinCommentInputUsesFocusedEditTextBeforeGlobalSetText() {
  var source = fs.readFileSync(path.join(__dirname, "../platforms/douyin/adapter.js"), "utf8");
  var start = source.indexOf("function sendLiveComment(replyText, options)");
  var end = source.indexOf("function likeCurrentLiveRoom", start);
  var body = source.slice(start, end);
  var focusedSetTextIndex = body.indexOf("focusedInput.setText(replyText)");
  var globalSetTextIndex = body.indexOf("setText(replyText)");

  assert(start >= 0 && end > start, "sendLiveComment must be present");
  assert(focusedSetTextIndex >= 0, "comment input must prefer the focused EditText node");
  assert(globalSetTextIndex < 0 || focusedSetTextIndex < globalSetTextIndex, "global setText may only be a fallback");
  assert(body.indexOf("options.shouldStop") >= 0, "comment input must expose stop checks around blocking actions");
}

function testInteractionStartsOnlyAfterTargetLiveIsMatched() {
  var events = [];
  var task = createTargetLiveEntryTask({
    runtime: {
      openDouyin: function () { events.push("open"); return true; },
      waitRandom: function () {},
      openSearch: function () { events.push("search"); return true; },
      openLiveTab: function () { events.push("tab"); return true; },
      openFirstLive: function () { events.push("first_live"); return true; },
      isLiveRoom: function () { return true; },
      readStableEvidence: function () { events.push("evidence"); return { ocrText: "当归直播间" }; },
      nextLive: function () { return true; },
      recover: function () {}
    },
    interactionRunner: {
      run: function () {
        events.push("interaction");
        return { status: "COMPLETED", likes: { completed: 7 }, comments: { sentComments: ["好内容"] } };
      }
    }
  });
  var result = task.run({ targetKeyword: "药材种植", relatedTerms: ["当归"] }, { shouldStop: function () { return false; } });
  assert.strictEqual(result.status, "TARGET_LIVE_ENTERED");
  assert.strictEqual(result.likes.completed, 7);
  assert.deepStrictEqual(result.comments.sentComments, ["好内容"]);
  assert.strictEqual(events.indexOf("interaction") > events.indexOf("evidence"), true);
}

function testRunsFinalCleanupOnlyAfterTheWholeLiveSessionCompletes() {
  var events = [];
  var task = createTargetLiveEntryTask({
    runtime: {
      openDouyin: function () { return true; },
      waitRandom: function () {},
      openSearch: function () { return true; },
      openLiveTab: function () { return true; },
      openFirstLive: function () { return true; },
      isLiveRoom: function () { return true; },
      readStableEvidence: function () { return { ocrText: "当归直播间" }; },
      nextLive: function () { return true; },
      recover: function () {}
    },
    sessionRunner: {
      run: function () {
        events.push("session");
        return { status: "COMPLETED", completedLiveCount: 2, lastInteraction: { likes: { completed: 7 }, comments: { sentComments: ["好内容"] } } };
      }
    },
    finalCleanup: {
      run: function (payload) {
        events.push("cleanup:" + payload.taskId);
        return { completed: true };
      }
    }
  });
  var result = task.run({ batchId: "batch-001", targetKeyword: "药材种植", relatedTerms: ["当归"] }, { shouldStop: function () { return false; } });
  assert.strictEqual(result.status, "TARGET_LIVE_ENTERED");
  assert.deepStrictEqual(events, ["session", "cleanup:batch-001"]);
  assert.strictEqual(result.completedLiveCount, 2);
}

function testFailsWhenFinalCleanupCannotReturnToAgent() {
  var task = createTargetLiveEntryTask({
    runtime: {
      openDouyin: function () { return true; }, waitRandom: function () {}, openSearch: function () { return true; },
      openLiveTab: function () { return true; }, openFirstLive: function () { return true; }, isLiveRoom: function () { return true; },
      readStableEvidence: function () { return { ocrText: "当归直播间" }; }, nextLive: function () { return true; }, recover: function () {}
    },
    sessionRunner: { run: function () { return { status: "COMPLETED" }; } },
    finalCleanup: { run: function () { return { completed: false, reason: "AGENT_RECENTS_CARD_NOT_FOUND" }; } }
  });
  var result = task.run({ targetKeyword: "药材种植", relatedTerms: ["当归"] }, { shouldStop: function () { return false; } });
  assert.strictEqual(result.status, "WARMUP_FINAL_CLEANUP_FAILED");
}
testLikeExecutorSkipsTheFinalLikeDelay();
testCommentFlowUsesConfiguredCountAndAllowsRepeatedWords();
testCommentFlowDoesNothingWhenCommentCountIsZero();
testCommentFlowStopsWhenBackendStopArrivesDuringInput();
testDouyinCommentInputUsesFocusedEditTextBeforeGlobalSetText();
testInteractionStartsOnlyAfterTargetLiveIsMatched();
testRunsFinalCleanupOnlyAfterTheWholeLiveSessionCompletes();
testFailsWhenFinalCleanupCannotReturnToAgent();
console.log("account warmup interaction runner tests passed");
