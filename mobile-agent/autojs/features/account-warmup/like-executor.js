function createLikeExecutor(options) {
  options = options || {};
  var logger = options.logger || { info: function () {}, warn: function () {} };
  var doubleTap = options.doubleTap || function () { return false; };
  var wait = options.wait || function () {};

  function stopped(control) {
    return !!(control && control.shouldStop && control.shouldStop());
  }

  function run(actions, control) {
    actions = actions || [];
    var completed = 0;
    for (var index = 0; index < actions.length; index++) {
      if (stopped(control)) return { status: "STOPPED", completed: completed };
      var action = actions[index];
      if (!doubleTap(action)) {
        logger.warn("养号点赞动作失败", { actionId: action.id, completed: completed });
        return { status: "LIKE_ACTION_FAILED", completed: completed, failedActionId: action.id };
      }
      completed += 1;
      logger.info("养号点赞动作完成", { actionId: action.id, completed: completed });
      if (index < actions.length - 1) wait(action.delayAfterMs);
    }
    return { status: "COMPLETED", completed: completed };
  }

  return { run: run };
}

module.exports = {
  createLikeExecutor: createLikeExecutor
};
