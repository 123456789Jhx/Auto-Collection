"use strict";

var DEFAULT_SCREEN_SIZE = { width: 1080, height: 2400 };
var CLICK_OPTIONS = { jitterX: 4, jitterY: 4 };
var DOUBLE_CLICK_OPTIONS = { intervalMinMs: 70, intervalMaxMs: 110 };
var WAIT_OPTIONS = { timeoutMs: 5000, pollIntervalMs: 200 };
var SWIPE_RATIOS = {
  up: { startX: 0.5, startY: 0.78, endX: 0.5, endY: 0.22 },
  down: { startX: 0.5, startY: 0.22, endX: 0.5, endY: 0.78 },
  left: { startX: 0.78, startY: 0.5, endX: 0.22, endY: 0.5 },
  right: { startX: 0.22, startY: 0.5, endX: 0.78, endY: 0.5 }
};
var SWIPE_OPTIONS = { durationMs: 520 };
function isNumber(value) { return typeof value === "number" && isFinite(value); }
function clamp(value, min, max) { return value < min ? min : value > max ? max : value; }
function normalizeScreenSize(screenSize) {
  screenSize = screenSize || {};
  return { width: Math.max(1, isNumber(screenSize.width) ? Math.floor(screenSize.width) : DEFAULT_SCREEN_SIZE.width),
    height: Math.max(1, isNumber(screenSize.height) ? Math.floor(screenSize.height) : DEFAULT_SCREEN_SIZE.height) };
}
function coordinateFromRatio(length, ratio) { return clamp(Math.round(length * clamp(isNumber(ratio) ? ratio : 0, 0, 1)), 0, length - 1); }
function clampPoint(point, screenSize) {
  var size = normalizeScreenSize(screenSize);
  return { x: clamp(point && isNumber(point.x) ? Math.round(point.x) : 0, 0, size.width - 1),
    y: clamp(point && isNumber(point.y) ? Math.round(point.y) : 0, 0, size.height - 1) };
}
function clampRegion(region, screenSize) {
  var size = normalizeScreenSize(screenSize); region = region || {};
  var left = clamp(Math.floor(isNumber(region.left) ? region.left : 0), 0, size.width - 1);
  var top = clamp(Math.floor(isNumber(region.top) ? region.top : 0), 0, size.height - 1);
  var width = Math.max(1, Math.floor(isNumber(region.width) ? region.width : 1));
  var height = Math.max(1, Math.floor(isNumber(region.height) ? region.height : 1));
  return { name: region.name || "region", left: left, top: top, width: Math.min(width, size.width - left), height: Math.min(height, size.height - top) };
}
function regionFromRatio(ratio, screenSize, name) {
  var size = normalizeScreenSize(screenSize); ratio = ratio || {};
  var leftRatio = clamp(isNumber(ratio.left) ? ratio.left : 0, 0, 1);
  var topRatio = clamp(isNumber(ratio.top) ? ratio.top : 0, 0, 1);
  if (ratio.independentSize === true) return clampRegion({ name: name, left: Math.floor(size.width * leftRatio), top: Math.floor(size.height * topRatio), width: Math.ceil(size.width * ratio.width), height: Math.ceil(size.height * ratio.height) }, size);
  var rightRatio = clamp(leftRatio + (isNumber(ratio.width) ? ratio.width : 0), 0, 1);
  var bottomRatio = clamp(topRatio + (isNumber(ratio.height) ? ratio.height : 0), 0, 1);
  var left = clamp(Math.floor(size.width * leftRatio), 0, size.width - 1);
  var top = clamp(Math.floor(size.height * topRatio), 0, size.height - 1);
  var right = clamp(Math.ceil(size.width * rightRatio), left + 1, size.width);
  var bottom = clamp(Math.ceil(size.height * bottomRatio), top + 1, size.height);
  return { name: name || "region", left: left, top: top, width: right - left, height: bottom - top };
}
function getSwipe(direction, screenSize, options) {
  var size = normalizeScreenSize(screenSize); options = options || {};
  var ratios = options.ratios || SWIPE_RATIOS[direction]; if (!ratios) return null;
  return { startX: coordinateFromRatio(size.width, ratios.startX), startY: coordinateFromRatio(size.height, ratios.startY),
    endX: coordinateFromRatio(size.width, ratios.endX), endY: coordinateFromRatio(size.height, ratios.endY),
    durationMs: isNumber(options.durationMs) ? Math.max(0, Math.floor(options.durationMs)) : SWIPE_OPTIONS.durationMs };
}
module.exports = { DEFAULT_SCREEN_SIZE: DEFAULT_SCREEN_SIZE, CLICK_OPTIONS: CLICK_OPTIONS, DOUBLE_CLICK_OPTIONS: DOUBLE_CLICK_OPTIONS,
  WAIT_OPTIONS: WAIT_OPTIONS, SWIPE_RATIOS: SWIPE_RATIOS, SWIPE_OPTIONS: SWIPE_OPTIONS, isNumber: isNumber, clamp: clamp,
  normalizeScreenSize: normalizeScreenSize, coordinateFromRatio: coordinateFromRatio, clampPoint: clampPoint,
  clampRegion: clampRegion, regionFromRatio: regionFromRatio, getSwipe: getSwipe };
