// 职责：把稳定 featureKey 映射到允许热更新的养号业务脚本。
function createAccountWarmupRegistry(context) {
  if (context.logger && context.logger.info) {
    context.logger.info("养号热更新探针", { probe: "WARMUP_HOT_RELOAD_OK" });
  }
  var targetLiveModule = context.loadBizScript("features/account-warmup/target-live-entry.js");
  var fastSearchModule = context.loadBizScript("features/account-warmup/fast-target-search.js");
  var likePlanModule = context.loadBizScript("features/account-warmup/like-plan.js");
  var likeTimingModule = context.loadBizScript("features/account-warmup/like-timing.js");
  var likeExecutorModule = context.loadBizScript("features/account-warmup/like-executor.js");
  var commentFlowModule = context.loadBizScript("features/account-warmup/comment-flow.js");
  var interactionRunnerModule = context.loadBizScript("features/account-warmup/interaction-runner.js");
  var liveSessionRunnerModule = context.loadBizScript("features/account-warmup/live-session-runner.js");
  var liveTransientPopupModule = context.loadBizScript("features/account-warmup/live-transient-popup.js");
  var videoWarmupFoundationModule = context.loadBizScript("features/account-warmup/video-warmup-foundation.js");
  var postPublishCleanupModule = context.loadBizScript("features/publish-video/douyin-post-publish-cleanup.js");
  var fastSearch = fastSearchModule.createFastTargetSearch({ context: context, logger: context.logger });
  var interactionRunner = interactionRunnerModule.createAccountWarmupInteractionRunner({
    context: context,
    logger: context.logger,
    createLikePlan: likePlanModule.createLikePlan,
    createLikeTiming: likeTimingModule.createLikeTiming,
    createLikeExecutor: likeExecutorModule.createLikeExecutor,
    createCommentFlow: commentFlowModule.createCommentFlow
  });
  var liveTransientPopup = liveTransientPopupModule.createLiveTransientPopupHandler({
    logger: context.logger
  });
  var liveSessionRunner = liveSessionRunnerModule.createLiveSessionRunner({
    logger: context.logger,
    interactionRunner: interactionRunner,
    wait: function (delayMs) { if (typeof sleep === "function") sleep(delayMs); },
    waitRandom: function (min, max) {
      var delayMs = Math.floor(min + Math.random() * (max - min + 1));
      if (typeof sleep === "function") sleep(delayMs);
      return delayMs;
    },
    isLiveRoom: function () { return !!(context.douyin && context.douyin.isLiveRoomVisible && context.douyin.isLiveRoomVisible()); },
    dismissTransientPopup: function () { return liveTransientPopup.dismiss(); },
    nextLive: function () {
      if (!context.douyin || !context.douyin.nextVideo) return false;
      return context.douyin.nextVideo() !== false;
    }
  });
  var finalCleanup = postPublishCleanupModule.createDouyinPostPublishCleanup({
    logger: context.logger,
    cooldownMs: 0,
    isPublishing: function () { return false; }
  });
  var featureFactories = {
    target_live_interaction: function (options) {
      return targetLiveModule.createTargetLiveEntryTask({
        context: context,
        logger: options && options.logger,
        fastSearch: fastSearch,
        interactionRunner: interactionRunner,
        sessionRunner: liveSessionRunner,
        finalCleanup: finalCleanup
      });
    },
    video_warmup: function (options) {
      return videoWarmupFoundationModule.createVideoWarmupFoundationTask({
        context: context,
        logger: options && options.logger || context.logger
      });
    }
  };

  function create(featureKey, options) {
    var factory = featureFactories[String(featureKey || "")];
    if (!factory) throw new Error("unsupported account warmup feature: " + String(featureKey || ""));
    return factory(options || {});
  }

  function cleanupAfterStop(payload) {
    payload = payload || {};
    return finalCleanup.run({ taskId: String(payload.taskId || payload.batchId || "") });
  }

  return { create: create, cleanupAfterStop: cleanupAfterStop };
}

module.exports = {
  createAccountWarmupRegistry: createAccountWarmupRegistry
};
