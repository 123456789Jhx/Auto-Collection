"use strict";

var contract = require("./contract.js");
var defaultLayout = require("./douyin-layout.js");

function createGestureActions(deps, layout) {
  deps = deps || {};
  layout = layout || defaultLayout;

  function checkStop() {
    if (typeof deps.shouldStop !== "function") {
      return null;
    }
    try {
      return deps.shouldStop() ? contract.stopped() : null;
    } catch (error) {
      return contract.failure(contract.REASON.STOP_CHECK_FAILED, "stop check failed");
    }
  }

  function readScreenSize() {
    var source;
    try {
      source = typeof deps.screenSize === "function" ? deps.screenSize() : deps.screenSize;
      return contract.success(layout.normalizeScreenSize(source));
    } catch (error) {
      return contract.failure(contract.REASON.DRIVER_ERROR, "screen size read failed");
    }
  }

  function randomInteger(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    if (max < min) {
      var previousMin = min;
      min = max;
      max = previousMin;
    }
    if (min === max) {
      return contract.success(min);
    }
    if (typeof deps.random !== "function") {
      return contract.failure(contract.REASON.DEPENDENCY_MISSING, "random dependency missing");
    }
    try {
      var value = Math.round(deps.random(min, max));
      return contract.success(Math.max(min, Math.min(max, value)));
    } catch (error) {
      return contract.failure(contract.REASON.DRIVER_ERROR, "random generation failed");
    }
  }

  function readNumber(value) {
    if (typeof value === "function") {
      value = value();
    }
    return typeof value === "number" && isFinite(value) ? value : null;
  }

  function readBounds(target) {
    var bounds = target && typeof target.bounds === "function" ? target.bounds() : target && target.bounds;
    if (!bounds) {
      return null;
    }
    var left = readNumber(bounds.left);
    var top = readNumber(bounds.top);
    var right = readNumber(bounds.right);
    var bottom = readNumber(bounds.bottom);
    if (left === null || top === null || right === null || bottom === null) {
      return null;
    }
    return { left: left, top: top, right: right, bottom: bottom };
  }

  function jitterValue(options, key, fallback) {
    var value = options && typeof options[key] === "number" ? options[key] : fallback;
    return Math.max(0, Math.floor(value));
  }

  function resolvePoint(target, options) {
    var sizeResult = readScreenSize();
    if (!sizeResult.success) {
      return sizeResult;
    }
    var size = sizeResult.value;
    var defaults = layout.CLICK_OPTIONS || {};
    var jitterX = jitterValue(options, "jitterX", defaults.jitterX || 0);
    var jitterY = jitterValue(options, "jitterY", defaults.jitterY || 0);
    var bounds;
    try {
      bounds = readBounds(target);
    } catch (error) {
      return contract.failure(contract.REASON.INVALID_TARGET, "target bounds read failed");
    }
    var minX;
    var maxX;
    var minY;
    var maxY;
    var centerX;
    var centerY;
    if (bounds) {
      minX = Math.max(0, Math.ceil(Math.min(bounds.left, bounds.right)));
      maxX = Math.min(size.width - 1, Math.ceil(Math.max(bounds.left, bounds.right)) - 1);
      minY = Math.max(0, Math.ceil(Math.min(bounds.top, bounds.bottom)));
      maxY = Math.min(size.height - 1, Math.ceil(Math.max(bounds.top, bounds.bottom)) - 1);
      if (maxX < minX || maxY < minY) {
        return contract.failure(contract.REASON.INVALID_TARGET, "target bounds outside screen");
      }
      centerX = Math.floor((minX + maxX) / 2);
      centerY = Math.floor((minY + maxY) / 2);
    } else {
      var targetX = target ? readNumber(target.x) : null;
      var targetY = target ? readNumber(target.y) : null;
      if (targetX === null || targetY === null) {
        return contract.failure(contract.REASON.INVALID_TARGET, "target must contain bounds or coordinates");
      }
      minX = 0;
      maxX = size.width - 1;
      minY = 0;
      maxY = size.height - 1;
      centerX = layout.clampPoint({ x: targetX, y: targetY }, size).x;
      centerY = layout.clampPoint({ x: targetX, y: targetY }, size).y;
    }
    var xOffset = randomInteger(-jitterX, jitterX);
    if (!xOffset.success) {
      return xOffset;
    }
    var yOffset = randomInteger(-jitterY, jitterY);
    if (!yOffset.success) {
      return yOffset;
    }
    return contract.success({
      x: Math.max(minX, Math.min(maxX, centerX + xOffset.value)),
      y: Math.max(minY, Math.min(maxY, centerY + yOffset.value))
    });
  }

  function driverMethod(name) {
    if (deps.driver && typeof deps.driver[name] === "function") {
      return { owner: deps.driver, method: deps.driver[name] };
    }
    if (typeof deps[name] === "function") {
      return { owner: deps, method: deps[name] };
    }
    return null;
  }

  function invokeDriver(name, args) {
    var callable = driverMethod(name);
    if (!callable) {
      return contract.failure(contract.REASON.DEPENDENCY_MISSING, name + " driver missing");
    }
    try {
      var value = callable.method.apply(callable.owner, args);
      if (value === false) {
        return contract.failure(contract.REASON.DRIVER_REJECTED, name + " driver returned false");
      }
      if (value && value.success === false) {
        return contract.failure(
          value.reason || contract.REASON.DRIVER_REJECTED,
          value.message || name + " driver rejected action",
          value.details
        );
      }
      return contract.success(value);
    } catch (error) {
      return contract.failure(contract.REASON.DRIVER_ERROR, name + " driver failed");
    }
  }

  function click(target, options) {
    var stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var point = resolvePoint(target, options || {});
    if (!point.success) {
      return point;
    }
    stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var driven = invokeDriver("click", [point.value.x, point.value.y]);
    stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    if (!driven.success) {
      return driven;
    }
    return contract.success(point.value);
  }

  function waitRandom(min, max) {
    var stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var duration = randomInteger(Math.max(0, min || 0), Math.max(0, max || 0));
    if (!duration.success) {
      return duration;
    }
    if (typeof deps.sleep !== "function") {
      return contract.failure(contract.REASON.DEPENDENCY_MISSING, "sleep dependency missing");
    }
    stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    try {
      if (deps.sleep(duration.value) === false) {
        return contract.failure(contract.REASON.SLEEP_ERROR, "sleep returned false");
      }
    } catch (error) {
      return contract.failure(contract.REASON.SLEEP_ERROR, "sleep failed");
    }
    stopped = checkStop();
    return stopped || contract.success(duration.value);
  }

  function doubleClick(target, options) {
    options = options || {};
    var stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var first = click(target, options);
    if (!first.success) {
      return first;
    }
    var defaults = layout.DOUBLE_CLICK_OPTIONS || {};
    var min = typeof options.intervalMinMs === "number" ? options.intervalMinMs : defaults.intervalMinMs;
    var max = typeof options.intervalMaxMs === "number" ? options.intervalMaxMs : defaults.intervalMaxMs;
    var waited = waitRandom(min, max);
    if (!waited.success) {
      return waited;
    }
    var second = click(target, options);
    if (!second.success) {
      return second;
    }
    return contract.success({ first: first.value, intervalMs: waited.value, second: second.value });
  }

  function swipe(direction, options) {
    var stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var size = readScreenSize();
    if (!size.success) {
      return size;
    }
    var gesture = layout.getSwipe(String(direction || "").toLowerCase(), size.value, options || {});
    if (!gesture) {
      return contract.failure(contract.REASON.INVALID_DIRECTION, "unsupported swipe direction");
    }
    stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    var driven = invokeDriver("swipe", [
      gesture.startX,
      gesture.startY,
      gesture.endX,
      gesture.endY,
      gesture.durationMs
    ]);
    stopped = checkStop();
    if (stopped) {
      return stopped;
    }
    if (!driven.success) {
      return driven;
    }
    return contract.success(gesture);
  }

  return {
    click: click,
    doubleClick: doubleClick,
    swipe: swipe,
    waitRandom: waitRandom
  };
}

module.exports = {
  createGestureActions: createGestureActions
};
