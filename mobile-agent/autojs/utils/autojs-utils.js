function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleepRandom(minMs, maxMs) {
  sleep(randomInt(minMs, maxMs));
}

var cachedScreenSize = null;
var lastScreenSource = "";

function isValidDimension(width, height) {
  return isFinite(width) && isFinite(height) && width >= 100 && height >= 100;
}

function normalizeScreenSize(width, height) {
  width = Math.floor(Number(width));
  height = Math.floor(Number(height));
  if (!isValidDimension(width, height)) {
    return null;
  }
  if (width > height) {
    return {
      width: height,
      height: width
    };
  }
  return {
    width: width,
    height: height
  };
}

function rememberScreenSize(size) {
  if (size && isValidDimension(size.width, size.height)) {
    cachedScreenSize = size;
  }
  return size;
}

function getDeviceScreenSize() {
  try {
    return normalizeScreenSize(device && device.width, device && device.height);
  } catch (error) {
    return null;
  }
}

function getDisplayMetricsScreenSize() {
  try {
    if (typeof context === "undefined" || !context || !context.getResources) {
      return null;
    }
    var metrics = context.getResources().getDisplayMetrics();
    return normalizeScreenSize(metrics && metrics.widthPixels, metrics && metrics.heightPixels);
  } catch (error) {
    return null;
  }
}

function getRootBoundsScreenSize() {
  try {
    if (typeof auto === "undefined" || !auto || !auto.rootInActiveWindow) {
      return null;
    }
    var root = auto.rootInActiveWindow();
    var bounds = root && root.bounds && root.bounds();
    if (!bounds) {
      return null;
    }
    return normalizeScreenSize(bounds.right, bounds.bottom);
  } catch (error) {
    return null;
  }
}

function getBoundsScreenSize(bounds) {
  if (!bounds) {
    return null;
  }
  var width = Number(bounds.right);
  var height = Number(bounds.bottom);
  if (!isFinite(width) || width < 100) {
    width = 0;
  }
  if (!isFinite(height) || height < 100) {
    height = 0;
  }
  if (width < 100 && height < 100) {
    return null;
  }
  return normalizeScreenSize(Math.max(width, 720), Math.max(height, 1280));
}

function getScreenSize(fallbackBounds) {
  var size = getDeviceScreenSize();
  if (size) {
    lastScreenSource = "device";
    return rememberScreenSize(size);
  }
  size = getDisplayMetricsScreenSize();
  if (size) {
    lastScreenSource = "display_metrics";
    return rememberScreenSize(size);
  }
  size = getRootBoundsScreenSize();
  if (size) {
    lastScreenSource = "root_bounds";
    return rememberScreenSize(size);
  }
  size = getBoundsScreenSize(fallbackBounds);
  if (size) {
    lastScreenSource = "fallback_bounds";
    return rememberScreenSize(size);
  }
  if (cachedScreenSize) {
    lastScreenSource = "cached";
    return cachedScreenSize;
  }
  lastScreenSource = "default";
  return rememberScreenSize({ width: 720, height: 1280 });
}

function describeScreenSize(fallbackBounds) {
  var rawDevice = {};
  try {
    rawDevice = {
      width: Number(device && device.width),
      height: Number(device && device.height)
    };
  } catch (error) {
    rawDevice = {
      width: null,
      height: null
    };
  }
  var size = getScreenSize(fallbackBounds);
  return {
    width: size.width,
    height: size.height,
    source: lastScreenSource,
    rawDeviceWidth: rawDevice.width,
    rawDeviceHeight: rawDevice.height,
    fallbackBounds: formatBounds(fallbackBounds)
  };
}

function formatBounds(bounds) {
  if (!bounds) {
    return "";
  }
  try {
    return "[" + bounds.left + "," + bounds.top + "][" + bounds.right + "," + bounds.bottom + "]";
  } catch (error) {
    return String(bounds);
  }
}

function waitForElement(selector, timeoutMs, region, logger) {
  var endTime = Date.now() + (timeoutMs || 5000);

  while (Date.now() <= endTime) {
    try {
      var node = region
        ? selector.boundsInside(region.x1, region.y1, region.x2, region.y2).findOne(100)
        : selector.findOne(100);
      if (node) {
        return node;
      }
    } catch (error) {
      if (logger) {
        logger.warn("查找控件异常", { message: String(error) });
      }
    }
    sleep(100);
  }

  return null;
}

function safeClick(node, maxDepth, logger) {
  if (!node) {
    return false;
  }

  var depthLimit = maxDepth || 3;

  try {
    if (node.clickable && node.clickable() && node.click()) {
      sleepRandom(500, 1000);
      return true;
    }
  } catch (error) {
    if (logger) {
      logger.debug("直接点击控件失败", { message: String(error) });
    }
  }

  try {
    var parent = node.parent();
    var depth = 1;
    while (parent && depth <= depthLimit) {
      if (parent.clickable && parent.clickable() && parent.click()) {
        sleepRandom(500, 1000);
        return true;
      }
      parent = parent.parent();
      depth += 1;
    }
  } catch (error) {
    if (logger) {
      logger.debug("点击父节点失败", { message: String(error) });
    }
  }

  return axisClick(node, logger);
}

function axisClick(node, logger) {
  if (!node || !node.bounds) {
    return false;
  }

  var bounds = node.bounds();
  if (!bounds || bounds.width() <= 0 || bounds.height() <= 0) {
    if (logger) {
      logger.warn("坐标点击控件失败：bounds无效", { bounds: formatBounds(bounds) });
    }
    return false;
  }

  var screen = getScreenSize(bounds);
  if (bounds.right < 0 || bounds.bottom < 0 || bounds.top > screen.height) {
    if (logger) {
      logger.warn("坐标点击控件失败：bounds越界", {
        bounds: formatBounds(bounds),
        screen: describeScreenSize(bounds)
      });
    }
    return false;
  }

  var x = bounds.centerX() + randomInt(-2, 2);
  var y = bounds.centerY() + randomInt(-2, 2);
  x = Math.max(1, Math.min(x, screen.width - 1));
  y = Math.max(1, Math.min(y, screen.height - 1));
  var durationMs = randomInt(100, 160);

  if (logger) {
    logger.info("坐标点击控件", {
      x: x,
      y: y,
      durationMs: durationMs,
      bounds: formatBounds(bounds),
      screen: describeScreenSize(bounds)
    });
  }

  press(x, y, durationMs);
  sleepRandom(500, 1000);
  return true;
}

function clickPoint(x, y, logger, label) {
  x = Math.floor(Number(x));
  y = Math.floor(Number(y));
  if (!isFinite(x) || !isFinite(y)) {
    if (logger) {
      logger.warn("坐标点击失败：输入坐标无效", { label: label || "", x: x, y: y });
    }
    return false;
  }
  var safeMinX = 1;
  var safeMinY = 1;
  var fallbackBounds = {
    left: x,
    top: y,
    right: x + 1,
    bottom: y + 1
  };
  var screen = getScreenSize(fallbackBounds);
  var safeMaxX = Math.max(safeMinX, screen.width - 1);
  var safeMaxY = Math.max(safeMinY, screen.height - 1);
  var targetX = randomInt(Math.floor(x - 8), Math.floor(x + 8));
  var targetY = randomInt(Math.floor(y - 8), Math.floor(y + 8));
  targetX = Math.max(safeMinX, Math.min(targetX, safeMaxX));
  targetY = Math.max(safeMinY, Math.min(targetY, safeMaxY));
  var durationMs = randomInt(90, 160);
  if (logger) {
    logger.info("坐标点击点位", {
      label: label || "",
      inputX: x,
      inputY: y,
      targetX: targetX,
      targetY: targetY,
      durationMs: durationMs,
      screen: describeScreenSize(fallbackBounds)
    });
  }
  press(
    targetX,
    targetY,
    durationMs
  );
  sleepRandom(500, 1000);
  return true;
}

function getCurrentPackageName() {
  try {
    var windows = auto.windows;
    for (var i = 0; i < windows.length; i++) {
      var window = windows[i];
      if (window.getType() === 1 && window.isFocused()) {
        return app.getPackageName(window.getTitle());
      }
    }
  } catch (error) {
    return currentPackage();
  }
  return currentPackage();
}

function verifyApp(appName, logger) {
  var expectedPackage = app.getPackageName(appName);
  var actualPackage = getCurrentPackageName();
  if (actualPackage !== expectedPackage) {
    var message = "当前应用不是 " + appName + "，当前包名：" + actualPackage;
    if (logger) {
      logger.warn(message);
    }
    return false;
  }
  return true;
}

function clickIfExists(selector, timeoutMs, logger) {
  var node = waitForElement(selector, timeoutMs || 1000, null, logger);
  if (!node) {
    return false;
  }
  return safeClick(node, 3, logger);
}

module.exports = {
  randomInt: randomInt,
  sleepRandom: sleepRandom,
  waitForElement: waitForElement,
  safeClick: safeClick,
  axisClick: axisClick,
  clickPoint: clickPoint,
  getCurrentPackageName: getCurrentPackageName,
  verifyApp: verifyApp,
  clickIfExists: clickIfExists
  ,
  getScreenSize: getScreenSize,
  describeScreenSize: describeScreenSize,
  formatBounds: formatBounds
};
