"use strict";

var MIN_BRIGHTNESS = 185;
var MAX_SATURATION = 55;
var MAX_HUE = 180;

function colorValue(first, second, third) {
  return (0xFF000000 | (first & 0xFF) << 16 | (second & 0xFF) << 8 | third & 0xFF);
}

function recycle(image) {
  if (image && typeof image.recycle === "function") image.recycle();
}

function failure(reason, message) {
  return { success: false, reason: reason, message: String(message || "") };
}

function preprocess(imageApi, image, options) {
  options = options || {};
  if (!imageApi || typeof imageApi.cvtColor !== "function" ||
      typeof imageApi.inRange !== "function") {
    return failure("COMMENT_WHITE_FILTER_UNAVAILABLE", "near-white image filter unavailable");
  }
  if (!image) return failure("COMMENT_WHITE_FILTER_INPUT_MISSING", "comment image missing");
  var hsv = null;
  try {
    hsv = imageApi.cvtColor(image, "BGR2HSV");
    if (!hsv) return failure("COMMENT_WHITE_FILTER_FAILED", "HSV conversion returned no image");
    var makeColor = typeof options.color === "function" ? options.color : colorValue;
    var output = imageApi.inRange(hsv,
      makeColor(0, 0, MIN_BRIGHTNESS),
      makeColor(MAX_HUE, MAX_SATURATION, 255));
    return output
      ? { success: true, image: output, minBrightness: MIN_BRIGHTNESS, maxSaturation: MAX_SATURATION }
      : failure("COMMENT_WHITE_FILTER_FAILED", "near-white mask returned no image");
  } catch (error) {
    return failure("COMMENT_WHITE_FILTER_FAILED", error && error.message || error);
  } finally {
    if (hsv && hsv !== image) recycle(hsv);
  }
}

module.exports = {
  MIN_BRIGHTNESS: MIN_BRIGHTNESS,
  MAX_SATURATION: MAX_SATURATION,
  preprocess: preprocess
};
