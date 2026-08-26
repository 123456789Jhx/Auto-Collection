"use strict";

var DEFAULT_SCREEN_SIZE = { width: 1080, height: 2400 };

var SELECTOR_DESCRIPTIONS = {
  searchEntry: [
    { method: "desc", value: "搜索" },
    { method: "text", value: "搜索" }
  ],
  searchInput: [
    { method: "className", value: "android.widget.EditText" }
  ],
  liveTab: [
    { method: "text", value: "直播" }
  ],
  commentInput: [
    { method: "textContains", value: "说点什么" },
    { method: "descContains", value: "说点什么" }
  ],
  liveEnded: [
    { method: "textContains", value: "直播已结束" },
    { method: "textContains", value: "主播已下播" }
  ],
  viewerCount: [
    { method: "textMatches", value: "(在线|观看|人气)" }
  ],
  platformVerification: [
    { method: "textContains", value: "安全验证" },
    { method: "textContains", value: "完成验证" },
    { method: "textContains", value: "拖动滑块" }
  ]
};

var CLICK_OPTIONS = {
  jitterX: 4,
  jitterY: 4
};

var DOUBLE_CLICK_OPTIONS = {
  intervalMinMs: 70,
  intervalMaxMs: 110
};

var WAIT_OPTIONS = {
  timeoutMs: 5000,
  pollIntervalMs: 200
};

var SWIPE_RATIOS = {
  up: { startX: 0.5, startY: 0.78, endX: 0.5, endY: 0.22 },
  down: { startX: 0.5, startY: 0.22, endX: 0.5, endY: 0.78 },
  left: { startX: 0.78, startY: 0.5, endX: 0.22, endY: 0.5 },
  right: { startX: 0.22, startY: 0.5, endX: 0.78, endY: 0.5 }
};

var SWIPE_OPTIONS = {
  durationMs: 520,
  commentStartY: 0.82,
  commentEndY: 0.18,
  liveRoomStartY: 0.78,
  liveRoomEndY: 0.22
};

var REGION_RATIOS = {
  comment: { left: 0.055, top: 0.622, width: 0.855, height: 0.247 },
  liveEnded: { left: 0.12, top: 0.3, width: 0.76, height: 0.3 },
  viewerCount: { left: 0.02, top: 0.03, width: 0.56, height: 0.16 },
  platformVerification: { left: 0.08, top: 0.18, width: 0.84, height: 0.64 }
};

function isNumber(value) {
  return typeof value === "number" && isFinite(value);
}

function clamp(value, min, max) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function normalizeScreenSize(screenSize) {
  screenSize = screenSize || {};
  var width = isNumber(screenSize.width) ? Math.floor(screenSize.width) : DEFAULT_SCREEN_SIZE.width;
  var height = isNumber(screenSize.height) ? Math.floor(screenSize.height) : DEFAULT_SCREEN_SIZE.height;
  return {
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

function coordinateFromRatio(length, ratio) {
  var boundedRatio = clamp(isNumber(ratio) ? ratio : 0, 0, 1);
  return clamp(Math.round(length * boundedRatio), 0, length - 1);
}

function clampPoint(point, screenSize) {
  var size = normalizeScreenSize(screenSize);
  var x = point && isNumber(point.x) ? Math.round(point.x) : 0;
  var y = point && isNumber(point.y) ? Math.round(point.y) : 0;
  return {
    x: clamp(x, 0, size.width - 1),
    y: clamp(y, 0, size.height - 1)
  };
}

function regionFromRatio(ratio, screenSize, name) {
  var size = normalizeScreenSize(screenSize);
  var leftRatio = clamp(isNumber(ratio.left) ? ratio.left : 0, 0, 1);
  var topRatio = clamp(isNumber(ratio.top) ? ratio.top : 0, 0, 1);
  var rightRatio = clamp(leftRatio + (isNumber(ratio.width) ? ratio.width : 0), 0, 1);
  var bottomRatio = clamp(topRatio + (isNumber(ratio.height) ? ratio.height : 0), 0, 1);
  var left = clamp(Math.floor(size.width * leftRatio), 0, size.width - 1);
  var top = clamp(Math.floor(size.height * topRatio), 0, size.height - 1);
  var right = clamp(Math.ceil(size.width * rightRatio), left + 1, size.width);
  var bottom = clamp(Math.ceil(size.height * bottomRatio), top + 1, size.height);
  return {
    name: name || "region",
    left: left,
    top: top,
    width: right - left,
    height: bottom - top
  };
}

function clampRegion(region, screenSize) {
  var size = normalizeScreenSize(screenSize);
  region = region || {};
  var left = clamp(Math.floor(isNumber(region.left) ? region.left : 0), 0, size.width - 1);
  var top = clamp(Math.floor(isNumber(region.top) ? region.top : 0), 0, size.height - 1);
  var width = Math.max(1, Math.floor(isNumber(region.width) ? region.width : 1));
  var height = Math.max(1, Math.floor(isNumber(region.height) ? region.height : 1));
  return {
    name: region.name || "region",
    left: left,
    top: top,
    width: Math.min(width, size.width - left),
    height: Math.min(height, size.height - top)
  };
}

function getRegion(name, screenSize) {
  var ratio = REGION_RATIOS[name];
  if (!ratio) {
    return null;
  }
  return regionFromRatio(ratio, screenSize, name);
}

function resolveRegion(region, screenSize) {
  if (typeof region === "string") {
    return getRegion(region, screenSize);
  }
  if (region && (region.relative === true || region.unit === "ratio")) {
    return regionFromRatio(region, screenSize, region.name);
  }
  return clampRegion(region, screenSize);
}

function getSwipe(direction, screenSize, options) {
  var size = normalizeScreenSize(screenSize);
  var ratios = options && options.ratios ? options.ratios : SWIPE_RATIOS[direction];
  if (!ratios) {
    return null;
  }
  return {
    startX: coordinateFromRatio(size.width, ratios.startX),
    startY: coordinateFromRatio(size.height, ratios.startY),
    endX: coordinateFromRatio(size.width, ratios.endX),
    endY: coordinateFromRatio(size.height, ratios.endY),
    durationMs: options && isNumber(options.durationMs)
      ? Math.max(0, Math.floor(options.durationMs))
      : SWIPE_OPTIONS.durationMs
  };
}

function getCommentSwipe(screenSize, options) {
  var region = getRegion("comment", screenSize);
  var startYRatio = options && isNumber(options.startYRatio)
    ? options.startYRatio
    : SWIPE_OPTIONS.commentStartY;
  var endYRatio = options && isNumber(options.endYRatio)
    ? options.endYRatio
    : SWIPE_OPTIONS.commentEndY;
  var centerX = region.left + Math.floor((region.width - 1) / 2);
  var startY = region.top + coordinateFromRatio(region.height, startYRatio);
  var endY = region.top + coordinateFromRatio(region.height, endYRatio);
  var size = normalizeScreenSize(screenSize);
  var start = clampPoint({ x: centerX, y: startY }, size);
  var end = clampPoint({ x: centerX, y: endY }, size);
  return {
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
    durationMs: options && isNumber(options.durationMs)
      ? Math.max(0, Math.floor(options.durationMs))
      : SWIPE_OPTIONS.durationMs
  };
}

function getLiveRoomSwitchSwipe(screenSize, options) {
  return getSwipe("up", screenSize, options);
}

function getCaptureRegions(screenSize) {
  return [
    getRegion("comment", screenSize),
    getRegion("liveEnded", screenSize),
    getRegion("viewerCount", screenSize)
  ];
}

module.exports = {
  DEFAULT_SCREEN_SIZE: DEFAULT_SCREEN_SIZE,
  SELECTOR_DESCRIPTIONS: SELECTOR_DESCRIPTIONS,
  SELECTORS: SELECTOR_DESCRIPTIONS,
  CLICK_OPTIONS: CLICK_OPTIONS,
  DOUBLE_CLICK_OPTIONS: DOUBLE_CLICK_OPTIONS,
  WAIT_OPTIONS: WAIT_OPTIONS,
  SWIPE_RATIOS: SWIPE_RATIOS,
  SWIPE_OPTIONS: SWIPE_OPTIONS,
  REGION_RATIOS: REGION_RATIOS,
  normalizeScreenSize: normalizeScreenSize,
  clampPoint: clampPoint,
  clampRegion: clampRegion,
  resolveRegion: resolveRegion,
  getRegion: getRegion,
  getSwipe: getSwipe,
  getCommentSwipe: getCommentSwipe,
  getLiveRoomSwitchSwipe: getLiveRoomSwitchSwipe,
  getCaptureRegions: getCaptureRegions
};
