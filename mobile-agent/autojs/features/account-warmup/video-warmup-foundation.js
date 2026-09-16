// 职责：视频养号任务的编排骨架——按固定顺序推进动作，并守住停机、手势重试与页面上下文三个不变量。
// 关键约定（2026-09-10 修复）：
// 1. 滑动起点在下、终点在上＝下一条视频（此前方向被写反）；
// 2. 下滑只派发贝塞尔曲线，禁止直线兜底（见远程脚本模块进度台账 2026-09-10）；派发被拒属瞬时状态，
//    在界面动作层内重试同一手法的贝塞尔路径，不降级到平台或全局直线滑动；
// 3. 连续 MAX_CONSECUTIVE_SWIPE_FAILURES 次滑动仍未派发成功才判定 SWIPE_FAILED；
// 4. 每次滑动后校验仍在抖音视频页，异常先复核、再恢复，恢复无效则明确结束任务；
// 5. 每个视频的观看等待在 10000~15000ms 内逐轮随机，payload.secondsPerVideo 仅保留兼容记录。

var swipeGeometry = require("./video-warmup-swipe.js");
var defaultUi = require("./video-warmup-ui.js");

var OPEN_APP_PRE_DELAY_MS = 1000;
var OPEN_APP_SETTLE_MS = 1500;
var NAVIGATION_SETTLE_MS = 800;
var SWIPE_SETTLE_MS = 600;
var CONTEXT_RECHECK_MS = 1200;
var CONTEXT_RECOVER_SETTLE_MS = 1500;
var MAX_CONSECUTIVE_SWIPE_FAILURES = 3;

function createVideoWarmupFoundationTask(options) {
  options = options || {};
  var context = options.context || {};
  var douyin = context.douyin || {};
  var logger = options.logger || { info: function () {} };
  var ui = options.ui || defaultUi.createDefaultUi({
    context: context,
    random: options.random,
    logger: logger
  });
  var wait = options.wait || context.sleep || function (delayMs) {
    if (typeof sleep === "function") sleep(delayMs);
  };
  var random = options.random || function (min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  };

  function stopped(control) {
    return !!(control && control.shouldStop && control.shouldStop());
  }

  function waitOrStop(delayMs, control) {
    var remaining = Math.max(0, Number(delayMs) || 0);
    while (remaining > 0) {
      if (stopped(control)) return true;
      var step = Math.min(500, remaining);
      wait(step);
      remaining -= step;
    }
    return stopped(control);
  }

  function stoppedResult(watchedVideos) {
    return { status: "STOPPED", watchedVideos: watchedVideos || 0 };
  }

  function swipeAccepted(result) {
    if (result === true) return true;
    return !!(result && result.accepted === true);
  }

  function swipeReason(result) {
    if (result && result.reason) return String(result.reason);
    return result === false || result === null || result === undefined
      ? "SWIPE_DISPATCH_REJECTED"
      : "";
  }

  function verifyContext(checkContext) {
    if (typeof checkContext !== "function") return { ok: true, reason: "NO_CONTEXT_PROBE" };
    try {
      var result = checkContext();
      if (result && result.ok === false) {
        return { ok: false, reason: String(result.reason || "VIDEO_CONTEXT_LOST") };
      }
    } catch (error) {
      return { ok: true, reason: "CONTEXT_PROBE_ERROR" };
    }
    return { ok: true, reason: "" };
  }

  function openVideoPage(keyword, control) {
    if (waitOrStop(OPEN_APP_PRE_DELAY_MS, control)) return "STOPPED";
    if (!douyin.openApp || douyin.openApp() === false) {
      if (logger.warn) logger.warn("视频养号打开抖音失败", {});
      return "DOUYIN_OPEN_FAILED";
    }
    if (waitOrStop(OPEN_APP_SETTLE_MS, control)) return "STOPPED";
    if (!ui.openSearchEntry()) {
      if (logger.warn) logger.warn("视频养号点击搜索入口失败", {});
      return "VIDEO_WARMUP_SEARCH_ENTRY_FAILED";
    }
    if (!ui.setSearchKeyword(keyword)) {
      if (logger.warn) logger.warn("视频养号输入关键词失败", { keyword: keyword });
      return "VIDEO_WARMUP_SEARCH_INPUT_FAILED";
    }
    if (waitOrStop(NAVIGATION_SETTLE_MS, control)) return "STOPPED";
    if (!ui.submitSearch()) {
      if (logger.warn) logger.warn("视频养号点击搜索按钮失败", { keyword: keyword });
      return "VIDEO_WARMUP_SEARCH_SUBMIT_FAILED";
    }
    if (waitOrStop(NAVIGATION_SETTLE_MS, control)) return "STOPPED";
    if (!ui.openUpperVideoTab()) {
      if (logger.warn) logger.warn("视频养号点击第一排视频菜单失败", {});
      return "VIDEO_WARMUP_UPPER_VIDEO_TAB_FAILED";
    }
    if (waitOrStop(NAVIGATION_SETTLE_MS, control)) return "STOPPED";
    if (!ui.openLowerVideoTab()) {
      if (logger.warn) logger.warn("视频养号点击第二排视频菜单失败", {});
      return "VIDEO_WARMUP_LOWER_VIDEO_TAB_FAILED";
    }
    if (waitOrStop(NAVIGATION_SETTLE_MS, control)) return "STOPPED";
    if (!ui.openFirstVideo()) {
      if (logger.warn) logger.warn("视频养号点击第一个视频失败", {});
      return "VIDEO_WARMUP_FIRST_VIDEO_FAILED";
    }
    return "";
  }

  function watchLoop(control) {
    var watchedVideos = 0;
    var consecutiveSwipeFailures = 0;
    var checkContext = ui.verifyVideoContext;
    while (!stopped(control)) {
      var watchDurationMs = swipeGeometry.resolveWatchDurationMs(random);
      if (waitOrStop(watchDurationMs, control)) return stoppedResult(watchedVideos);
      var swipe = ui.nextVideo(control);
      if (!swipeAccepted(swipe)) {
        consecutiveSwipeFailures += 1;
        if (logger.warn) logger.warn("视频养号下一视频手势未派发", {
          watchedVideos: watchedVideos,
          consecutiveSwipeFailures: consecutiveSwipeFailures,
          reason: swipeReason(swipe)
        });
        if (consecutiveSwipeFailures >= MAX_CONSECUTIVE_SWIPE_FAILURES) {
          return {
            status: "VIDEO_WARMUP_SWIPE_FAILED",
            watchedVideos: watchedVideos,
            consecutiveSwipeFailures: consecutiveSwipeFailures
          };
        }
        continue;
      }
      consecutiveSwipeFailures = 0;
      watchedVideos += 1;
      if (waitOrStop(SWIPE_SETTLE_MS, control)) return stoppedResult(watchedVideos);

      var screenContext = verifyContext(checkContext);
      if (!screenContext.ok) {
        if (waitOrStop(CONTEXT_RECHECK_MS, control)) return stoppedResult(watchedVideos);
        screenContext = verifyContext(checkContext);
      }
      if (!screenContext.ok) {
        if (logger.warn) logger.warn("视频养号视频页上下文丢失", {
          watchedVideos: watchedVideos,
          reason: screenContext.reason,
          swipePath: String(swipe && swipe.path || "")
        });
        var recovered = ui.recoverVideoContext ? ui.recoverVideoContext() : false;
        if (!recovered) {
          return {
            status: "VIDEO_WARMUP_CONTEXT_LOST",
            watchedVideos: watchedVideos,
            reason: "CONTEXT_RECOVER_UNAVAILABLE"
          };
        }
        if (waitOrStop(CONTEXT_RECOVER_SETTLE_MS, control)) return stoppedResult(watchedVideos);
        var recoveredContext = verifyContext(checkContext);
        if (!recoveredContext.ok) {
          return {
            status: "VIDEO_WARMUP_CONTEXT_LOST",
            watchedVideos: watchedVideos,
            reason: recoveredContext.reason
          };
        }
      }
      logger.info("视频养号已滑到下一个视频", {
        watchedVideos: watchedVideos,
        watchDurationMs: watchDurationMs,
        swipePath: String(swipe && swipe.path || ""),
        contextReason: screenContext.reason || ""
      });
    }
    return stoppedResult(watchedVideos);
  }

  function run(payload, control) {
    payload = payload || {};
    var keyword = String(payload.targetKeyword || "").trim();
    var secondsPerVideo = swipeGeometry.resolveSecondsPerVideo(payload.secondsPerVideo);
    if (!keyword) {
      if (logger.warn) logger.warn("视频养号搜索关键词为空", {});
      return { status: "VIDEO_WARMUP_KEYWORD_REQUIRED" };
    }
    logger.info("视频养号开始打开抖音", {
      targetKeyword: keyword,
      secondsPerVideo: secondsPerVideo,
      payloadSecondsPerVideo: Number(payload.secondsPerVideo) > 0 ? Number(payload.secondsPerVideo) : null
    });
    var openFailure = openVideoPage(keyword, control);
    if (openFailure === "STOPPED") return stoppedResult(0);
    if (openFailure) return { status: openFailure };
    return watchLoop(control);
  }

  return { run: run };
}

module.exports = {
  createVideoWarmupFoundationTask: createVideoWarmupFoundationTask,
  createDefaultUi: defaultUi.createDefaultUi,
  videoSwipeCoordinates: swipeGeometry.videoSwipeCoordinates,
  bowControlPoints: swipeGeometry.bowControlPoints,
  resolveSecondsPerVideo: swipeGeometry.resolveSecondsPerVideo,
  resolveWatchDurationMs: swipeGeometry.resolveWatchDurationMs,
  WATCH_DURATION_MIN_MS: swipeGeometry.WATCH_DURATION_MIN_MS,
  WATCH_DURATION_MAX_MS: swipeGeometry.WATCH_DURATION_MAX_MS,
  SWIPE_ACTION_SIGNATURE: swipeGeometry.SWIPE_ACTION_SIGNATURE
};
