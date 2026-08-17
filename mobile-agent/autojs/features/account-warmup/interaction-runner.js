function createAccountWarmupInteractionRunner(options) {
  options = options || {};
  var context = options.context || {};
  var douyin = context.douyin || {};
  var logger = options.logger || context.logger || { info: function () {}, warn: function () {} };
  var createLikePlan = options.createLikePlan;
  var createLikeTiming = options.createLikeTiming;
  var createLikeExecutor = options.createLikeExecutor;
  var createCommentFlow = options.createCommentFlow;
  var random = options.random || Math.random;

  function wait(delayMs) {
    if (typeof sleep === "function") sleep(Math.max(0, Number(delayMs) || 0));
  }

  function waitRandom(min, max) {
    var value = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    var delayMs = Math.floor(min + value * (max - min + 1));
    wait(delayMs);
    return delayMs;
  }

  function screenSize() {
    return {
      width: Math.max(1, Number(typeof device !== "undefined" && device.width || 1080)),
      height: Math.max(1, Number(typeof device !== "undefined" && device.height || 2400))
    };
  }

  function doubleTap(action) {
    if (!douyin.isLiveRoomVisible || !douyin.isLiveRoomVisible()) return false;
    if (typeof click !== "function") return false;
    if (!click(action.x, action.y)) return false;
    wait(80);
    return !!click(action.x, action.y);
  }

  function run(payload, control) {
    if (!createLikePlan || !createLikeTiming || !createLikeExecutor || !createCommentFlow) {
      return { status: "INTERACTION_MODULE_MISSING" };
    }
    var timing = createLikeTiming({ random: random, logger: logger });
    var plan = createLikePlan({ random: random, timing: timing, screenSize: screenSize, logger: logger });
    var likeResult = createLikeExecutor({ logger: logger, doubleTap: doubleTap, wait: wait }).run(plan.actions, control);
    if (likeResult.status !== "COMPLETED") return { status: likeResult.status, likes: likeResult };

    var commentResult = createCommentFlow({
      random: random,
      waitRandom: waitRandom,
      logger: logger,
      sendComment: function (text, sendOptions) { return douyin.sendLiveComment && douyin.sendLiveComment(text, sendOptions); }
    }).run(payload, control);
    if (commentResult.status !== "COMPLETED") return { status: commentResult.status, likes: likeResult, comments: commentResult };
    return { status: "COMPLETED", likes: likeResult, comments: commentResult };
  }

  return { run: run };
}

module.exports = {
  createAccountWarmupInteractionRunner: createAccountWarmupInteractionRunner
};
