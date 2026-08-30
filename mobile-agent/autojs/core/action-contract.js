"use strict";

var REASON = {
  STOP_REQUESTED: "STOP_REQUESTED",
  INVALID_TARGET: "INVALID_TARGET",
  INVALID_DIRECTION: "INVALID_DIRECTION",
  DEPENDENCY_MISSING: "DEPENDENCY_MISSING",
  DRIVER_REJECTED: "DRIVER_REJECTED",
  DRIVER_ERROR: "DRIVER_ERROR",
  SLEEP_ERROR: "SLEEP_ERROR",
  STOP_CHECK_FAILED: "STOP_CHECK_FAILED",
  TIME_SOURCE_ERROR: "TIME_SOURCE_ERROR",
  NODE_LOOKUP_FAILED: "NODE_LOOKUP_FAILED",
  NODE_TIMEOUT: "NODE_TIMEOUT",
  NODE_TEXT_UNAVAILABLE: "NODE_TEXT_UNAVAILABLE",
  NODE_READ_FAILED: "NODE_READ_FAILED",
  SCREEN_CAPTURE_FAILED: "SCREEN_CAPTURE_FAILED",
  OCR_FAILED: "OCR_FAILED",
  IMAGE_RECYCLE_FAILED: "IMAGE_RECYCLE_FAILED",
  PLATFORM_VERIFICATION: "PLATFORM_VERIFICATION",
  VERIFICATION_CHECK_FAILED: "VERIFICATION_CHECK_FAILED",
};
var STATUS = {
  READY: "READY",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  STOPPED: "STOPPED",
};
function success(value) {
  var result = { success: true };
  if (arguments.length > 0) result.value = value;
  return result;
}
function failure(reason, message, details) {
  var result = { success: false, reason: reason, message: message };
  if (arguments.length > 2) result.details = details;
  return result;
}
function stopped() {
  return failure(REASON.STOP_REQUESTED, "task stopped");
}
module.exports = {
  REASON: REASON,
  REASONS: REASON,
  STATUS: STATUS,
  STATUSES: STATUS,
  success: success,
  failure: failure,
  stopped: stopped,
};
