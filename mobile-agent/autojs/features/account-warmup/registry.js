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
  var baselineLoader = context.loadBaselineScript || context.loadBizScript;
  var liveCommentEntryModule = baselineLoader("features/account-warmup/live-comment-entry.js");
  var liveCommentRuntimeModule = baselineLoader("features/account-warmup/live-comment-entry-runtime.js");
  var liveCommentRunnerModule = baselineLoader("features/account-warmup/live-comment-entry-comment-runner.js");
  var liveCommentCaptureModule = baselineLoader("domain/live-comment-capture.js");
  var postPublishCleanupModule = context.loadBizScript("features/publish-video/douyin-post-publish-cleanup.js");
  var fastSearch = fastSearchModule.createFastTargetSearch({ context: context, logger: context.logger });
  var liveCommentContext = {};
  Object.keys(context).forEach(function (key) { liveCommentContext[key] = context[key]; });
  liveCommentContext.forceBaselineLiveCommentEntry = true;
  var liveCommentRuntime = liveCommentRuntimeModule.createDefaultRuntime(liveCommentContext, null, {
    gestureMode: "accessibility"
  });
  var interactionRunner = null;
  var liveTransientPopup = null;
  var liveSessionRunner = null;
  var finalCleanup = null;

  function getInteractionRunner(logger) {
    if (!interactionRunner) {
      interactionRunner = interactionRunnerModule.createAccountWarmupInteractionRunner({
        context: context,
        logger: logger || context.logger,
        createLikePlan: likePlanModule.createLikePlan,
        createLikeTiming: likeTimingModule.createLikeTiming,
        createLikeExecutor: likeExecutorModule.createLikeExecutor,
        createCommentFlow: commentFlowModule.createCommentFlow
      });
    }
    return interactionRunner;
  }

  function getLiveSessionRunner(logger) {
    if (!liveSessionRunner) {
      if (!liveTransientPopup) {
        liveTransientPopup = liveTransientPopupModule.createLiveTransientPopupHandler({ logger: logger || context.logger });
      }
      liveSessionRunner = liveSessionRunnerModule.createLiveSessionRunner({
        logger: logger || context.logger,
        interactionRunner: getInteractionRunner(logger),
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
    }
    return liveSessionRunner;
  }

  function getFinalCleanup(logger) {
    if (!finalCleanup) {
      finalCleanup = postPublishCleanupModule.createDouyinPostPublishCleanup({
        logger: logger || context.logger,
        cooldownMs: 0,
        isPublishing: function () { return false; }
      });
    }
    return finalCleanup;
  }
  var featureFactories = {
    target_live_interaction: function (options) {
      return targetLiveModule.createTargetLiveEntryTask({
        context: context,
        logger: options && options.logger,
        fastSearch: fastSearch,
        interactionRunner: getInteractionRunner(options && options.logger),
        sessionRunner: getLiveSessionRunner(options && options.logger),
        finalCleanup: getFinalCleanup(options && options.logger)
      });
    },
    video_warmup: function (options) {
      return videoWarmupFoundationModule.createVideoWarmupFoundationTask({
        context: context,
        logger: options && options.logger || context.logger
      });
    },
    live_comment_entry: function (options) {
      return liveCommentEntryModule.createLiveCommentEntryTask({
        context: liveCommentContext,
        logger: options && options.logger || context.logger,
        gestureMode: "accessibility",
        runtime: liveCommentRuntime,
        runtimeAdapter: liveCommentRuntimeModule,
        captureRunnerModule: liveCommentRunnerModule,
        commentCapture: liveCommentCaptureModule,
        reportStage: options && options.reportStage,
        finalCleanup: getFinalCleanup(options && options.logger)
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
    return getFinalCleanup().run({ taskId: String(payload.taskId || payload.batchId || "") });
  }

  return { create: create, cleanupAfterStop: cleanupAfterStop };
}

module.exports = {
  createAccountWarmupRegistry: createAccountWarmupRegistry
};
