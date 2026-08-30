"use strict";

var contract = require("./action-contract.js");
var geometry = require("./screen-geometry.js");

function createGestureActions(deps, layout) {
  deps = deps || {};
  if (!layout) throw new Error("gesture layout is required");
  function checkStop() {
    try {
      return deps.shouldStop && deps.shouldStop() ? contract.stopped() : null;
    } catch (error) {
      return contract.failure(
        contract.REASON.STOP_CHECK_FAILED,
        "stop check failed",
      );
    }
  }
  function size() {
    try {
      var source =
        typeof deps.screenSize === "function"
          ? deps.screenSize()
          : deps.screenSize;
      return contract.success(layout.normalizeScreenSize(source));
    } catch (error) {
      return contract.failure(
        contract.REASON.DRIVER_ERROR,
        "screen size read failed",
      );
    }
  }
  function random(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    if (max < min) {
      var swap = min;
      min = max;
      max = swap;
    }
    if (min === max) return contract.success(min);
    if (typeof deps.random !== "function")
      return contract.failure(
        contract.REASON.DEPENDENCY_MISSING,
        "random dependency missing",
      );
    try {
      return contract.success(
        Math.max(min, Math.min(max, Math.round(deps.random(min, max)))),
      );
    } catch (error) {
      return contract.failure(
        contract.REASON.DRIVER_ERROR,
        "random generation failed",
      );
    }
  }
  function number(value) {
    try {
      value = typeof value === "function" ? value() : value;
    } catch (error) {
      return null;
    }
    return typeof value === "number" && isFinite(value) ? value : null;
  }
  function point(target, options) {
    var screen = size();
    if (!screen.success) return screen;
    var bounds;
    try {
      bounds =
        target &&
        (typeof target.bounds === "function" ? target.bounds() : target.bounds);
    } catch (error) {
      return contract.failure(
        contract.REASON.INVALID_TARGET,
        "target bounds read failed",
      );
    }
    var minX, maxX, minY, maxY, centerX, centerY, value;
    if (bounds) {
      var left = number(bounds.left),
        right = number(bounds.right),
        top = number(bounds.top),
        bottom = number(bounds.bottom);
      if (
        [left, right, top, bottom].some(function (item) {
          return item === null;
        })
      )
        return contract.failure(
          contract.REASON.INVALID_TARGET,
          "target bounds read failed",
        );
      minX = Math.max(0, Math.ceil(Math.min(left, right)));
      maxX = Math.min(
        screen.value.width - 1,
        Math.ceil(Math.max(left, right)) - 1,
      );
      minY = Math.max(0, Math.ceil(Math.min(top, bottom)));
      maxY = Math.min(
        screen.value.height - 1,
        Math.ceil(Math.max(top, bottom)) - 1,
      );
      if (maxX < minX || maxY < minY)
        return contract.failure(
          contract.REASON.INVALID_TARGET,
          "target bounds outside screen",
        );
      centerX = Math.floor((minX + maxX) / 2);
      centerY = Math.floor((minY + maxY) / 2);
    } else {
      var x = number(target && target.x),
        y = number(target && target.y);
      if (x === null || y === null)
        return contract.failure(
          contract.REASON.INVALID_TARGET,
          "target must contain bounds or coordinates",
        );
      minX = 0;
      maxX = screen.value.width - 1;
      minY = 0;
      maxY = screen.value.height - 1;
      value = layout.clampPoint({ x: x, y: y }, screen.value);
      centerX = value.x;
      centerY = value.y;
    }
    var jitterX = Math.max(
      0,
      Math.floor(
        options && typeof options.jitterX === "number"
          ? options.jitterX
          : (layout.CLICK_OPTIONS || {}).jitterX || 0,
      ),
    );
    var jitterY = Math.max(
      0,
      Math.floor(
        options && typeof options.jitterY === "number"
          ? options.jitterY
          : (layout.CLICK_OPTIONS || {}).jitterY || 0,
      ),
    );
    var dx = random(-jitterX, jitterX);
    if (!dx.success) return dx;
    var dy = random(-jitterY, jitterY);
    if (!dy.success) return dy;
    return contract.success({
      x: Math.max(minX, Math.min(maxX, centerX + dx.value)),
      y: Math.max(minY, Math.min(maxY, centerY + dy.value)),
    });
  }
  function driver(name, args) {
    var owner =
      deps.driver && typeof deps.driver[name] === "function"
        ? deps.driver
        : deps;
    if (!owner || typeof owner[name] !== "function")
      return contract.failure(
        contract.REASON.DEPENDENCY_MISSING,
        name + " driver missing",
      );
    try {
      var value = owner[name].apply(owner, args);
      if (value === false || (value && value.success === false))
        return contract.failure(
          (value && value.reason) || contract.REASON.DRIVER_REJECTED,
          (value && value.message) || name + " driver rejected action",
          value && value.details,
        );
      return contract.success(value);
    } catch (error) {
      return contract.failure(
        contract.REASON.DRIVER_ERROR,
        name + " driver failed",
      );
    }
  }
  function click(target, options) {
    var stopped = checkStop();
    if (stopped) return stopped;
    var resolved = point(target, options || {});
    if (!resolved.success) return resolved;
    stopped = checkStop();
    if (stopped) return stopped;
    var result = driver("click", [resolved.value.x, resolved.value.y]);
    stopped = checkStop();
    return (
      stopped || (!result.success ? result : contract.success(resolved.value))
    );
  }
  function waitRandom(min, max) {
    var stopped = checkStop();
    if (stopped) return stopped;
    var duration = random(Math.max(0, min || 0), Math.max(0, max || 0));
    if (!duration.success) return duration;
    if (typeof deps.sleep !== "function")
      return contract.failure(
        contract.REASON.DEPENDENCY_MISSING,
        "sleep dependency missing",
      );
    stopped = checkStop();
    if (stopped) return stopped;
    try {
      if (deps.sleep(duration.value) === false)
        return contract.failure(
          contract.REASON.SLEEP_ERROR,
          "sleep returned false",
        );
    } catch (error) {
      return contract.failure(contract.REASON.SLEEP_ERROR, "sleep failed");
    }
    stopped = checkStop();
    return stopped || contract.success(duration.value);
  }
  function doubleClick(target, options) {
    options = options || {};
    var first = click(target, options);
    if (!first.success) return first;
    var defaults = layout.DOUBLE_CLICK_OPTIONS || {};
    var waited = waitRandom(
      typeof options.intervalMinMs === "number"
        ? options.intervalMinMs
        : defaults.intervalMinMs,
      typeof options.intervalMaxMs === "number"
        ? options.intervalMaxMs
        : defaults.intervalMaxMs,
    );
    if (!waited.success) return waited;
    var second = click(target, options);
    return second.success
      ? contract.success({
          first: first.value,
          intervalMs: waited.value,
          second: second.value,
        })
      : second;
  }
  function swipe(direction, options) {
    var stopped = checkStop();
    if (stopped) return stopped;
    var screen = size();
    if (!screen.success) return screen;
    var gesture = layout.getSwipe(
      String(direction || "").toLowerCase(),
      screen.value,
      options || {},
    );
    if (!gesture)
      return contract.failure(
        contract.REASON.INVALID_DIRECTION,
        "unsupported swipe direction",
      );
    stopped = checkStop();
    if (stopped) return stopped;
    var result = driver("swipe", [
      gesture.startX,
      gesture.startY,
      gesture.endX,
      gesture.endY,
      gesture.durationMs,
    ]);
    stopped = checkStop();
    return stopped || (!result.success ? result : contract.success(gesture));
  }
  return {
    click: click,
    doubleClick: doubleClick,
    swipe: swipe,
    waitRandom: waitRandom,
  };
}
module.exports = { createGestureActions: createGestureActions };
