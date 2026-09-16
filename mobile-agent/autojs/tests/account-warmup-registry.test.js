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
      assert.doesNotMatch(path, /live-comment-entry|domain\/live-comment-capture/);
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
    "features/publish-video/douyin-post-publish-cleanup.js"
  ]);
  assert.throws(function () { registry.create("live_comment_entry"); }, /unsupported account warmup feature/);
  assert.strictEqual(interactionRunnerCreated, 0);
  assert.strictEqual(liveSessionRunnerCreated, 0);
  assert.strictEqual(typeof registry.create("target_live_interaction").run, "function");
  assert.strictEqual(interactionRunnerCreated, 1);
  assert.strictEqual(liveSessionRunnerCreated, 1);
  assert.deepStrictEqual(registry.create("video_warmup").run(), { status: "VIDEO_WARMUP_DOUYIN_OPENED" });
  assert.deepStrictEqual(registry.cleanupAfterStop({ taskId: "run-1", batchId: "batch-1" }), { completed: true });
  assert.deepStrictEqual(cleanupPayloads, [{ taskId: "run-1" }]);
  assert.strictEqual(loaded.length, 11);
  assert.throws(function () { registry.create("../../app/control-loop.js"); }, /unsupported account warmup feature/);
}

testLoadsOnlyAllowlistedFeatureKeys();

function testPreloadsWarmupDependenciesBeforeTaskThread() {
  var startupPhase = true;
  var lateLoads = [];
  var context = {};
  function load(path) {
    if (!startupPhase) lateLoads.push(path);
    assert.doesNotMatch(path, /live-comment-entry|domain\/live-comment-capture/);
    if (/douyin-post-publish-cleanup/.test(path)) {
      return { createDouyinPostPublishCleanup: function () { return { run: function () { return { completed: true }; } }; } };
    }
    if (/fast-target-search/.test(path)) return { createFastTargetSearch: function () { return {}; } };
    if (/like-plan/.test(path)) return { createLikePlan: function () {} };
    if (/like-timing/.test(path)) return { createLikeTiming: function () {} };
    if (/like-executor/.test(path)) return { createLikeExecutor: function () {} };
    if (/comment-flow/.test(path)) return { createCommentFlow: function () {} };
    if (/interaction-runner/.test(path)) return { createAccountWarmupInteractionRunner: function () { return {}; } };
    if (/live-session-runner/.test(path)) return { createLiveSessionRunner: function () { return {}; } };
    if (/live-transient-popup/.test(path)) return { createLiveTransientPopupHandler: function () { return {}; } };
    if (/video-warmup-foundation/.test(path)) return { createVideoWarmupFoundationTask: function () { return {}; } };
    return { createTargetLiveEntryTask: function () { return {}; } };
  }
  context.loadBizScript = load;
  context.loadBaselineScript = load;

  var registry = createRegistry(context);
  startupPhase = false;
  registry.create("target_live_interaction");
  registry.create("video_warmup");
  registry.cleanupAfterStop({ taskId: "run-preloaded" });

  assert.deepStrictEqual(lateLoads, []);
}

testPreloadsWarmupDependenciesBeforeTaskThread();
console.log("account warmup registry tests passed");
