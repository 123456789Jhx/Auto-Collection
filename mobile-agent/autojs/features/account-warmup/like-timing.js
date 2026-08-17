// 职责：计算养号点赞动作之间的普通间隔与每三次后的长停顿。
function createLikeTiming(options) {
  options = options || {};
  var random = options.random || Math.random;
  var logger = options.logger || { info: function () {} };

  function randomInt(min, max) {
    var value = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    return Math.floor(min + value * (max - min + 1));
  }

  function nextDelay(completedDoubleTaps) {
    var completed = Math.max(0, Math.floor(Number(completedDoubleTaps) || 0));
    var extended = completed > 0 && completed % 3 === 0;
    var delayMs = extended ? randomInt(5255, 7565) : randomInt(1200, 5400);
    delayMs = Math.max(1000, delayMs);
    var result = {
      kind: extended ? "extended_pause" : "standard",
      delayMs: delayMs
    };
    logger.info("养号点赞间隔已生成", {
      completedDoubleTaps: completed,
      kind: result.kind,
      delayMs: result.delayMs
    });
    return result;
  }

  return { nextDelay: nextDelay };
}

module.exports = {
  createLikeTiming: createLikeTiming
};
