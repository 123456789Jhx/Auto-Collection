"use strict";
var geometry = require("../../core/screen-geometry.js");
var SELECTOR_DESCRIPTIONS = {
  searchEntry: [
    { method: "desc", value: "搜索" },
    { method: "text", value: "搜索" },
  ],
  searchInput: [{ method: "className", value: "android.widget.EditText" }],
  liveTab: [{ method: "text", value: "直播" }],
  commentInput: [
    { method: "textContains", value: "说点什么" },
    { method: "descContains", value: "说点什么" },
  ],
  liveEnded: [
    { method: "textContains", value: "直播已结束" },
    { method: "textContains", value: "主播已下播" },
  ],
  viewerCount: [{ method: "textMatches", value: "(在线|观看|人气)" }],
  platformVerification: [
    { method: "textContains", value: "安全验证" },
    { method: "textContains", value: "完成验证" },
    { method: "textContains", value: "拖动滑块" },
  ],
};
var SWIPE_OPTIONS = {
  durationMs: 520,
  commentStartY: 0.1795,
  commentEndY: 0.8205,
  liveRoomStartY: 0.78,
  liveRoomEndY: 0.22,
};
var REGION_RATIOS = {
  comment: { left: 0.03, top: 0.635, width: 0.70, height: 0.245 },
  liveEnded: {
    left: 0.32,
    top: 0.06,
    width: 0.38,
    height: 0.055,
    independentSize: true,
  },
  viewerCount: {
    left: 0.75,
    top: 0.06,
    width: 0.1575,
    height: 0.027,
    independentSize: true,
  },
  commerceCart: {
    left: 680 / 1080,
    top: 1965 / 2248,
    width: 110 / 1080,
    height: 90 / 2248,
    independentSize: true,
  },
  anchorHeaderTap: {
    left: 33 / 1080,
    top: 112 / 2248,
    width: 280 / 1080,
    height: 99 / 2248,
    independentSize: true,
  },
  anchorSummaryProfileTap: {
    left: 39 / 1080,
    top: 1461 / 2248,
    width: 204 / 1080,
    height: 204 / 2248,
    independentSize: true,
  },
  anchorProfileBackTap: {
    left: 44 / 1080,
    top: 116 / 2248,
    width: 88 / 1080,
    height: 88 / 2248,
    independentSize: true,
  },
  platformVerification: { left: 0.08, top: 0.18, width: 0.84, height: 0.64 },
};
function getRegion(name, screenSize) {
  if (name === "anchorProfileCapture" || name === "anchorIdentity") {
    var profileSize = geometry.normalizeScreenSize(screenSize);
    var left = name === "anchorIdentity" ? Math.round(360 * profileSize.width / 1080) : 0;
    var top = name === "anchorIdentity" ? Math.round(271 * profileSize.height / 2248) : 0;
    var right = name === "anchorIdentity" ? Math.round(1003 * profileSize.width / 1080) : profileSize.width;
    var bottom = name === "anchorIdentity" ? Math.round(540 * profileSize.height / 2248) : profileSize.height;
    return geometry.clampRegion({ name: name, left: left, top: top,
      width: right - left, height: bottom - top }, profileSize);
  }
  if (name === "commentHistoryEnd") {
    var size = geometry.normalizeScreenSize(screenSize);
    return geometry.clampRegion({ name: name, left: Math.round(39 * size.width / 1080),
      top: Math.round(1483 * size.height / 2248), width: Math.round(346 * size.width / 1080),
      height: Math.round(71 * size.height / 2248) }, size);
  }
  return REGION_RATIOS[name]
    ? geometry.regionFromRatio(REGION_RATIOS[name], screenSize, name)
    : null;
}
function resolveRegion(region, screenSize) {
  if (typeof region === "string") return getRegion(region, screenSize);
  return region && (region.relative === true || region.unit === "ratio")
    ? geometry.regionFromRatio(region, screenSize, region.name)
    : geometry.clampRegion(region, screenSize);
}
function getCommentSwipe(screenSize, options) {
  var region = getRegion("comment", screenSize);
  options = options || {};
  var start = geometry.coordinateFromRatio(
    region.height,
    geometry.isNumber(options.startYRatio)
      ? options.startYRatio
      : SWIPE_OPTIONS.commentStartY,
  );
  var end = geometry.coordinateFromRatio(
    region.height,
    geometry.isNumber(options.endYRatio)
      ? options.endYRatio
      : SWIPE_OPTIONS.commentEndY,
  );
  var size = geometry.normalizeScreenSize(screenSize);
  var x = region.left + Math.floor((region.width - 1) / 2);
  var first = geometry.clampPoint({ x: x, y: region.top + start }, size);
  var last = geometry.clampPoint({ x: x, y: region.top + end }, size);
  return {
    startX: first.x,
    startY: first.y,
    endX: last.x,
    endY: last.y,
    durationMs: geometry.isNumber(options.durationMs)
      ? Math.max(0, Math.floor(options.durationMs))
      : SWIPE_OPTIONS.durationMs,
  };
}
function getLiveRoomSwitchSwipe(screenSize, options) {
  options = options || {};
  return geometry.getSwipe("up", screenSize, {
    ratios: {
      startX: 0.5,
      startY: geometry.isNumber(options.startYRatio)
        ? options.startYRatio
        : SWIPE_OPTIONS.liveRoomStartY,
      endX: 0.5,
      endY: geometry.isNumber(options.endYRatio)
        ? options.endYRatio
        : SWIPE_OPTIONS.liveRoomEndY,
    },
    durationMs: options.durationMs,
  });
}
function getCaptureRegions(screenSize) {
  return [
    getRegion("comment", screenSize),
    getRegion("liveEnded", screenSize),
    getRegion("viewerCount", screenSize),
  ];
}
module.exports = {
  DEFAULT_SCREEN_SIZE: geometry.DEFAULT_SCREEN_SIZE,
  SELECTOR_DESCRIPTIONS: SELECTOR_DESCRIPTIONS,
  SELECTORS: SELECTOR_DESCRIPTIONS,
  CLICK_OPTIONS: geometry.CLICK_OPTIONS,
  DOUBLE_CLICK_OPTIONS: geometry.DOUBLE_CLICK_OPTIONS,
  WAIT_OPTIONS: geometry.WAIT_OPTIONS,
  SWIPE_RATIOS: geometry.SWIPE_RATIOS,
  SWIPE_OPTIONS: SWIPE_OPTIONS,
  REGION_RATIOS: REGION_RATIOS,
  normalizeScreenSize: geometry.normalizeScreenSize,
  clampPoint: geometry.clampPoint,
  clampRegion: geometry.clampRegion,
  resolveRegion: resolveRegion,
  getRegion: getRegion,
  getSwipe: geometry.getSwipe,
  getCommentSwipe: getCommentSwipe,
  getLiveRoomSwitchSwipe: getLiveRoomSwitchSwipe,
  getCaptureRegions: getCaptureRegions,
};
