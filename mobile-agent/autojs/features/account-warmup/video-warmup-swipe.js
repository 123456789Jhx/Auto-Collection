// 职责：视频养号滑动手势的几何计算与停留时长解析。纯函数，不触碰任何 AutoX.js 原生 API。

var DEFAULT_SECONDS_PER_VIDEO = 10;
var MIN_SECONDS_PER_VIDEO = 3;
var MAX_SECONDS_PER_VIDEO = 600;
var WATCH_DURATION_MIN_MS = 10000;
var WATCH_DURATION_MAX_MS = 15000;
// 基准仍为 520ms，仅做小幅抖动，每次滑动路径与时长都不同。
var SWIPE_DURATION_MIN_MS = 480;
var SWIPE_DURATION_MAX_MS = 600;
var SWIPE_ACTION_SIGNATURE = "video_bezier_bow_v2";

// 停留秒数取自后台 payload；缺省 10 秒，越界时收敛到安全区间。
function resolveSecondsPerVideo(value) {
  var seconds = Math.floor(Number(value));
  if (!value || !isFinite(seconds) || seconds <= 0) return DEFAULT_SECONDS_PER_VIDEO;
  if (seconds < MIN_SECONDS_PER_VIDEO) return MIN_SECONDS_PER_VIDEO;
  if (seconds > MAX_SECONDS_PER_VIDEO) return MAX_SECONDS_PER_VIDEO;
  return seconds;
}

function resolveWatchDurationMs(randomizer) {
  var randomInt = typeof randomizer === "function" ? randomizer : function (min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  };
  var duration;
  try {
    duration = Math.floor(Number(randomInt(WATCH_DURATION_MIN_MS, WATCH_DURATION_MAX_MS)));
  } catch (error) {
    duration = WATCH_DURATION_MIN_MS;
  }
  if (!isFinite(duration)) return WATCH_DURATION_MIN_MS;
  return Math.max(WATCH_DURATION_MIN_MS, Math.min(WATCH_DURATION_MAX_MS, duration));
}

// 起点在下、终点在上：手指由下往上滑 = 下一条视频，与 core/screen-geometry.js 的 SWIPE_RATIOS.up 语义一致。
function videoSwipeCoordinates(size, randomInt) {
  size = size || {};
  var width = Math.max(1, Number(size.width) || 1080);
  var height = Math.max(1, Number(size.height) || 2248);
  randomInt = randomInt || function (min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  };
  var scaleX = width / 1080;
  var scaleY = height / 2248;
  var start = { x: randomInt(498, 547), y: randomInt(1444, 1602) };
  var end = { x: randomInt(471, 549), y: randomInt(395, 625) };
  start.x = Math.floor(start.x * scaleX);
  start.y = Math.floor(start.y * scaleY);
  end.x = Math.floor(end.x * scaleX);
  end.y = Math.floor(end.y * scaleY);
  var deltaX = end.x - start.x;
  var deltaY = end.y - start.y;
  return {
    start: start,
    end: end,
    controlPoints: bowControlPoints(start, deltaX, deltaY, randomInt),
    durationMs: randomInt(SWIPE_DURATION_MIN_MS, SWIPE_DURATION_MAX_MS)
  };
}

// 两个控制点同侧、幅度不同：得到「接近直线但不笔直」的不规则弧线，
// 既不是笔直直线，也不是正圆弧，更不是 S 形。
function bowControlPoints(start, deltaX, deltaY, randomInt) {
  var length = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;
  var normalX = -deltaY / length;
  var normalY = deltaX / length;
  var bow = Math.max(12, Math.round(length * 0.06));
  var sign = randomInt(0, 1) % 2 === 0 ? 1 : -1;
  var firstAt = randomInt(26, 40) / 100;
  var secondAt = randomInt(60, 76) / 100;
  var firstOffset = randomInt(Math.round(bow * 0.6), bow) * sign;
  var secondOffset = randomInt(Math.round(bow * 0.2), Math.round(bow * 0.7)) * sign;
  return [
    {
      x: Math.round(start.x + deltaX * firstAt + normalX * firstOffset),
      y: Math.round(start.y + deltaY * firstAt + normalY * firstOffset)
    },
    {
      x: Math.round(start.x + deltaX * secondAt + normalX * secondOffset),
      y: Math.round(start.y + deltaY * secondAt + normalY * secondOffset)
    }
  ];
}

module.exports = {
  resolveSecondsPerVideo: resolveSecondsPerVideo,
  resolveWatchDurationMs: resolveWatchDurationMs,
  videoSwipeCoordinates: videoSwipeCoordinates,
  bowControlPoints: bowControlPoints,
  DEFAULT_SECONDS_PER_VIDEO: DEFAULT_SECONDS_PER_VIDEO,
  MIN_SECONDS_PER_VIDEO: MIN_SECONDS_PER_VIDEO,
  MAX_SECONDS_PER_VIDEO: MAX_SECONDS_PER_VIDEO,
  WATCH_DURATION_MIN_MS: WATCH_DURATION_MIN_MS,
  WATCH_DURATION_MAX_MS: WATCH_DURATION_MAX_MS,
  SWIPE_DURATION_MIN_MS: SWIPE_DURATION_MIN_MS,
  SWIPE_DURATION_MAX_MS: SWIPE_DURATION_MAX_MS,
  SWIPE_ACTION_SIGNATURE: SWIPE_ACTION_SIGNATURE
};
