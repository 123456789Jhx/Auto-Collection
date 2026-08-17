var assert = require("assert");
var createRegistry = require("../features/account-warmup/registry.js").createAccountWarmupRegistry;

function testLoadsOnlyAllowlistedFeatureKeys() {
  var loaded = [];
  var cleanupPayloads = [];
  var interactionRunnerCreated = 0;
  var liveSessionRunnerCreated = 0;
  var registry = createRegistry({
    loadBizScript: function (path) {
      loaded.push(path);
      if (/douyin-post-publish-cleanup/.test(path)) {
        return { createDouyinPostPublishCleanup: function () { return { run: function (payload) { cleanupPayloads.push(payload); return { completed: true }; } }; } };
      }
      if (/fast-target-search/.test(path)) {
        return { createFastTargetSearch: function () { return { openSearch: function () {} }; } };
      }
      if (/like-plan/.test(path)) return { createLikePlan: function () {} };
      if (/like-timing/.test(path)) return { createLikeTiming: function () {} };
      if (/like-executor/.test(path)) return { createLikeExecutor: function () {} };
      if (/comment-flow/.test(path)) return { createCommentFlow: function () {} };
      if (/live-transient-popup/.test(path)) {
        return { createLiveTransientPopupHandler: function () { return { dismiss: function () { return false; } }; } };
      }
      if (/live-session-runner/.test(path)) {
        return { createLiveSessionRunner: function () { liveSessionRunnerCreated += 1; return { run: function () {} }; } };
      }
      if (/interaction-runner/.test(path)) {
        return { createAccountWarmupInteractionRunner: function () { interactionRunnerCreated += 1; return { run: function () {} }; } };
      }
      if (/video-warmup-foundation/.test(path)) {
        return { createVideoWarmupFoundationTask: function () { return { run: function () { return { status: "VIDEO_WARMUP_DOUYIN_OPENED" }; } }; } };
      }
      if (/live-comment-entry/.test(path)) {
        return { createLiveCommentEntryTask: function () { return { run: function () { return { status: "LIVE_COMMENT_ENTRY_ENTERED" }; } }; } };
      }
      return { createTargetLiveEntryTask: function () { return { run: function () {} }; } };
    }
  });

  assert.deepStrictEqual(loaded, [
    "features/account-warmup/target-live-entry.js",
    "features/account-warmup/fast-target-search.js",
    "features/account-warmup/like-plan.js",
    "features/account-warmup/like-timing.js",
    "features/account-warmup/like-executor.js",
    "features/account-warmup/comment-flow.js",
    "features/account-warmup/interaction-runner.js",
    "features/account-warmup/live-session-runner.js",
    "features/account-warmup/live-transient-popup.js",
    "features/account-warmup/video-warmup-foundation.js",
    "features/account-warmup/live-comment-entry.js",
    "features/publish-video/douyin-post-publish-cleanup.js"
  ]);
  assert.deepStrictEqual(registry.create("live_comment_entry").run(), { status: "LIVE_COMMENT_ENTRY_ENTERED" });
  assert.strictEqual(interactionRunnerCreated, 0);
  assert.strictEqual(liveSessionRunnerCreated, 0);
  assert.strictEqual(typeof registry.create("target_live_interaction").run, "function");
  assert.strictEqual(interactionRunnerCreated, 1);
  assert.strictEqual(liveSessionRunnerCreated, 1);
  assert.deepStrictEqual(registry.create("video_warmup").run(), { status: "VIDEO_WARMUP_DOUYIN_OPENED" });
  assert.deepStrictEqual(registry.cleanupAfterStop({ taskId: "run-1", batchId: "batch-1" }), { completed: true });
  assert.deepStrictEqual(cleanupPayloads, [{ taskId: "run-1" }]);
  assert.strictEqual(loaded.length, 12);
  assert.throws(function () { registry.create("../../app/control-loop.js"); }, /unsupported account warmup feature/);
}

testLoadsOnlyAllowlistedFeatureKeys();
console.log("account warmup registry tests passed");
