"use strict";

var layout = require("./douyin-layout.js");

function log(options, level, message, details) {
  try {
    if (options.logger && typeof options.logger[level] === "function") {
      options.logger[level](message, details);
    }
  } catch (error) {}
}

function recycle(image) {
  try { if (image && typeof image.recycle === "function") image.recycle(); } catch (error) {}
}

function readAnchorProfile(options) {
  options = options || {};
  var image = null, crop = null;
  var size = layout.normalizeScreenSize(options.screenSize);
  var result = {
    screenshotPath: "", screenshotSaved: false, ocrExecuted: false, ocrSucceeded: false,
    text: "", captureRegion: layout.getRegion("anchorProfileCapture", size),
    identityRegion: layout.getRegion("anchorIdentity", size)
  };
  var activeStage = "CAPTURING_ANCHOR_PROFILE";
  function fail(reason, message) {
    result.failedStage = activeStage;
    log(options, "warn", "主播主页采集未完成", {
      reason: reason, message: message, profile: result
    });
    return { success: false, reason: reason, message: message, details: result };
  }
  function stopped() { return !!(options.shouldStop && options.shouldStop()); }
  try {
    if (stopped()) return fail("STOP_REQUESTED", "task stopped");
    if (typeof options.captureScreen !== "function" || !options.images ||
        typeof options.images.save !== "function") {
      return fail("SCREEN_CAPTURE_FAILED", "全屏截图或保存能力不可用");
    }
    log(options, "info", "主播主页全屏截图开始", { captureRegion: result.captureRegion });
    var snapshot = options.captureScreen();
    image = snapshot && snapshot.image ? snapshot.image : snapshot;
    if (!image) return fail("SCREEN_CAPTURE_FAILED", "全屏截图为空");
    if (typeof image.getWidth === "function" && typeof image.getHeight === "function") {
      size = { width: image.getWidth(), height: image.getHeight() };
      result.captureRegion = layout.getRegion("anchorProfileCapture", size);
      result.identityRegion = layout.getRegion("anchorIdentity", size);
    }
    var directory = String(options.screenshotDir || ".");
    if (options.files && typeof options.files.ensureDir === "function") {
      options.files.ensureDir(directory + "/");
    }
    var filename = "anchor-profile-" + Date.now() + ".png";
    var path = options.files && typeof options.files.join === "function"
      ? options.files.join(directory, filename) : directory + "/" + filename;
    if (options.images.save(image, path) === false) {
      return fail("SCREEN_CAPTURE_FAILED", "全屏截图保存失败");
    }
    result.screenshotPath = path;
    result.screenshotSaved = true;
    log(options, "info", "主播主页全屏截图完成", result);

    activeStage = "READING_ROOM_IDENTITY";
    if (stopped()) return fail("STOP_REQUESTED", "task stopped");
    if (typeof options.images.clip !== "function" || !options.ocrEngine ||
        typeof options.ocrEngine.recognize !== "function") {
      return fail("OCR_UNAVAILABLE", "指定区域 OCR 能力不可用");
    }
    var region = result.identityRegion;
    log(options, "info", "主播主页区域 OCR 开始", {
      screenshotPath: path, identityRegion: region
    });
    crop = options.images.clip(image, region.left, region.top, region.width, region.height);
    if (!crop) return fail("OCR_FAILED", "指定区域裁剪为空");
    result.ocrExecuted = true;
    result.text = String(options.ocrEngine.recognize(crop) || "");
    if (stopped()) return fail("STOP_REQUESTED", "task stopped");
    if (!result.text.trim()) return fail("OCR_EMPTY", "指定区域未识别到文字");
    result.ocrSucceeded = true;
    log(options, "info", "主播主页区域 OCR 完成", result);
    return { success: true, value: result };
  } catch (error) {
    return fail(activeStage === "CAPTURING_ANCHOR_PROFILE" ? "SCREEN_CAPTURE_FAILED" : "OCR_FAILED",
      String(error && error.message || error));
  } finally {
    if (crop !== image) recycle(crop);
    recycle(image);
  }
}

module.exports = { readAnchorProfile: readAnchorProfile };
