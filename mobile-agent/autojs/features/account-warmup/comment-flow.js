function createCommentFlow(options) {
  options = options || {};
  var random = options.random || Math.random;
  var waitRandom = options.waitRandom || function () { return 0; };
  var sendComment = options.sendComment || function () { return { success: false, failureReason: "comment_sender_missing" }; };
  var logger = options.logger || { info: function () {}, warn: function () {} };

  function stopped(control) {
    return !!(control && control.shouldStop && control.shouldStop());
  }

  function normalizeLibrary(values) {
    var library = [];
    values = values || [];
    for (var index = 0; index < values.length; index++) {
      var value = String(values[index] || "").trim();
      if (value) library.push(value);
    }
    return library;
  }

  function randomInt(min, max) {
    var value = Math.max(0, Math.min(0.999999999, Number(random()) || 0));
    return Math.floor(min + value * (max - min + 1));
  }

  function randomItem(values) {
    return values[randomInt(0, values.length - 1)];
  }

  function run(payload, control) {
    payload = payload || {};
    var commentCount = Math.max(0, Math.floor(Number(payload.commentCount) || 0));
    var library = normalizeLibrary(payload.commentLibrary);
    var sentComments = [];
    if (!commentCount) return { status: "COMPLETED", sentComments: sentComments };
    if (!library.length) return { status: "COMMENT_LIBRARY_EMPTY", sentComments: sentComments };

    for (var index = 0; index < commentCount; index++) {
      if (stopped(control)) return { status: "STOPPED", sentComments: sentComments };
      var delayMs;
      if (index === 0) {
        delayMs = waitRandom(2345, 4876);
        logger.info("养号首条评论前等待完成", { delayMs: delayMs });
      } else {
        delayMs = waitRandom(3634, 5187);
        logger.info("养号多条评论间隔完成", { delayMs: delayMs, commentIndex: index + 1 });
      }
      if (stopped(control)) return { status: "STOPPED", sentComments: sentComments };

      var comment = randomItem(library);
      logger.info("养号评论发送开始", { commentIndex: index + 1, totalCount: commentCount });
      var result = sendComment(comment, {
        allowUnconfiguredReply: true,
        afterInputClickDelayMs: index === 0 ? randomInt(2345, 4876) : 0,
        skipDefaultInputDelay: true,
        shouldStop: function () { return stopped(control); }
      }) || {};
      if (stopped(control)) return { status: "STOPPED", sentComments: sentComments };
      if (!result.success) {
        var failureReason = String(result.failureReason || "comment_send_failed");
        logger.warn("养号评论发送失败", { commentIndex: index + 1, failureReason: failureReason });
        return { status: "COMMENT_SEND_FAILED", sentComments: sentComments, failureReason: failureReason };
      }
      sentComments.push(comment);
      logger.info("养号评论发送完成", { commentIndex: index + 1, totalCount: commentCount });
    }
    return { status: "COMPLETED", sentComments: sentComments };
  }

  return { run: run };
}

module.exports = {
  createCommentFlow: createCommentFlow
};
