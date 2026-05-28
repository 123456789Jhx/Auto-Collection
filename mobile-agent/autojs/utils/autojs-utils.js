function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleepRandom(minMs, maxMs) {
  sleep(randomInt(minMs, maxMs));
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
    return false;
  }

  if (bounds.right < 0 || bounds.bottom < 0 || bounds.top > device.height) {
    return false;
  }

  var x = bounds.centerX() + randomInt(-2, 2);
  var y = bounds.centerY() + randomInt(-2, 2);
  x = Math.max(0, Math.min(x, device.width));
  y = Math.max(0, Math.min(y, device.height));

  if (logger) {
    logger.debug("坐标点击控件", { x: x, y: y });
  }

  press(x, y, randomInt(100, 160));
  sleepRandom(500, 1000);
  return true;
}

function clickPoint(x, y) {
  press(
    randomInt(Math.floor(x - 8), Math.floor(x + 8)),
    randomInt(Math.floor(y - 8), Math.floor(y + 8)),
    randomInt(90, 160)
  );
  sleepRandom(500, 1000);
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
};
