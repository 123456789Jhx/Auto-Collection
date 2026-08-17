// 职责：生成红框内不重复坐标的点赞 dry-run 计划。
function createLikePlan(options) {
  options = options || {};
  var random = options.random || Math.random;
  var screenSize = options.screenSize || defaultScreenSize;
  var timing = options.timing;
  var logger = options.logger || { info: function () {} };
  if (!timing || !timing.nextDelay) throw new Error("LIKE_TIMING_REQUIRED");

  function randomInt(min, max) {
    var value = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    return Math.floor(min + value * (max - min + 1));
  }

  var size = screenSize();
  var bounds = {
    left: Math.floor(size.width * 0.09),
    right: Math.floor(size.width * 0.96),
    top: Math.floor(size.height * 0.21),
    bottom: Math.floor(size.height * 0.669)
  };
  var actionCount = randomInt(7, 14);
  var actions = [];
  var usedPoints = {};
  var attempts = 0;
  while (actions.length < actionCount && attempts < 800) {
    attempts += 1;
    var x = randomInt(bounds.left, bounds.right);
    var y = randomInt(bounds.top, bounds.bottom);
    var pointKey = x + ":" + y;
    if (usedPoints[pointKey]) continue;
    usedPoints[pointKey] = true;
    var completed = actions.length + 1;
    var delay = timing.nextDelay(completed);
    actions.push({
      id: "like-" + completed,
      type: "double_tap",
      x: x,
      y: y,
      delayKind: delay.kind,
      delayAfterMs: delay.delayMs
    });
  }
  if (actions.length !== actionCount) throw new Error("LIKE_PLAN_COORDINATE_EXHAUSTED");
  var plan = {
    mode: "dry-run",
    bounds: bounds,
    actionCount: actionCount,
    actions: actions
  };
  logger.info("养号点赞试运行计划已生成", {
    actionCount: actionCount,
    bounds: bounds,
    actions: actions
  });
  return plan;
}

function defaultScreenSize() {
  return {
    width: Math.max(1, Number(typeof device !== "undefined" && device.width || 1080)),
    height: Math.max(1, Number(typeof device !== "undefined" && device.height || 2400))
  };
}

module.exports = {
  createLikePlan: createLikePlan
};
